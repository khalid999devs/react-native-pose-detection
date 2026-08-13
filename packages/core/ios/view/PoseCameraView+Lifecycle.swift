import ExpoModulesCore
import UIKit

/**
 Attaching, detaching, and the four things the OS can tell this view about.

 Android needs a `LifecycleOwner`, a `ComponentCallbacks2`, a `DisplayListener` and an explicit
 destroy hook, and leaks an Activity if any one of them is unregistered on only one of the two
 teardown paths. Here they are four notifications registered together and removed together, in
 `deinit` as well, so a view released without a detach still lets go.
 */
extension PoseCameraView {
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detachFromWindow()
    } else {
      attachToWindow()
    }
  }

  private func attachToWindow() {
    removeObservers()
    // Token-based, and every token is kept, so detaching removes exactly what this view added
    // rather than everything anybody registered against it.
    observe(UIApplication.didReceiveMemoryWarningNotification) { $0.handleMemoryWarning() }
    observe(UIApplication.didEnterBackgroundNotification) { $0.handleBackground() }
    observe(UIApplication.willEnterForegroundNotification) { $0.handleForeground() }
    // The interface can turn 180 degrees without any other callback firing, which would leave the
    // capture connection on a stale rotation and every landmark arriving upside down.
    observe(UIDevice.orientationDidChangeNotification) { $0.camera.updateTargetRotation() }

    startLogTimer()
    // Reattaching after a temporary detach re-establishes whatever the props already say, rather
    // than waiting for a prop to change before the camera comes back.
    onPropsUpdated()
  }

  /**
   Detaching is not destruction: a view scrolled out of a list comes back. Releases the session but
   keeps the analysis queue, which a reattached view still needs.
   */
  private func detachFromWindow() {
    removeObservers()
    logTimer?.invalidate()
    logTimer = nil
    PoseLog.releaseStream(self)

    camera.setAnalyzerEnabled(false)
    camera.release()
    releaseDetector()
    completeSwitch()
    started = false
    readySent = false
  }

  private func observe(_ name: Notification.Name, _ handler: @escaping (PoseCameraView) -> Void) {
    let token = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
      guard let self = self else { return }
      handler(self)
    }
    observerTokens.append(token)
  }

  func removeObservers() {
    for token in observerTokens {
      NotificationCenter.default.removeObserver(token)
    }
    observerTokens.removeAll()
  }

  /// The process is next to be killed. The landmarker is the largest block we can give back.
  private func handleMemoryWarning() {
    PoseLog.warn(.detector, "memory warning, releasing the landmarker")
    releaseDetector()
    overlayView.clearPose()
  }

  /**
   Backgrounding gives up the landmarker rather than holding its GPU memory. AVFoundation stops the
   session itself when the app loses the camera; this is the half it does not know about.
   */
  private func handleBackground() {
    PoseLog.info(.camera, "backgrounded, releasing the detector")
    releaseDetector()
    overlayView.clearPose()
  }

  private func handleForeground() {
    guard started, propActive else { return }
    PoseLog.info(.camera, "foregrounded, restoring detection")
    applyDetectionState()
  }

  /**
   One view drains the shared buffer, whoever attached first, and hands it over as an event. The
   timer runs while the view is attached and costs one lock per tick when nothing is streaming,
   which is cheaper than a way for the module to reach every view.
   */
  private func startLogTimer() {
    logTimer?.invalidate()
    logTimer = Timer.scheduledTimer(
      withTimeInterval: PoseCameraView.logFlushSeconds,
      repeats: true
    ) { [weak self] _ in
      self?.flushLog()
    }
  }

  private func flushLog() {
    guard PoseLog.isStreaming, PoseLog.claimStream(self) else { return }

    var entries = [[String: Any]]()
    let dropped = PoseLog.drain(into: &entries)
    guard !entries.isEmpty || dropped > 0 else { return }

    // The drop count opens the batch as a warn entry rather than riding beside it, so a listener
    // that only reads entries still sees that something was lost.
    if dropped > 0 {
      entries.insert([
        "level": "warn",
        "category": "engine",
        "message": "\(dropped) log entries were dropped before this batch",
        "timestamp": Double(Monotonic.nowMs()),
        "data": ["droppedCount": dropped]
      ], at: 0)
    }
    onLog(["entries": entries])
  }
}
