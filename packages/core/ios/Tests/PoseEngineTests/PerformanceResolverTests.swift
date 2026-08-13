import XCTest
@testable import PoseEngine

/// The precedence chain from `guides/performance.md`, which is the whole point of this resolver.
final class PerformanceResolverTests: XCTestCase {
  private func resolve(
    profile: Profile = .auto,
    tier: DeviceTier = .medium,
    autoFps: Int? = nil,
    fps: Int? = nil,
    preview: String = "auto",
    analysis: String = "auto",
    thermal: ThermalState = .nominal,
    policy: ThermalPolicy = .adaptive
  ) -> ResolvedPerformance {
    return PerformanceResolver.resolve(PerformanceRequest(
      profile: profile,
      tier: tier,
      autoFps: autoFps,
      requestedFps: fps,
      requestedPreview: preview,
      requestedAnalysis: analysis,
      thermal: thermal,
      policy: policy
    ))
  }

  func testAutoTakesTheTierRateUntilTheGovernorHasMeasuredOne() {
    XCTAssertEqual(resolve(tier: .low).targetFps, 15)
    XCTAssertEqual(resolve(tier: .medium).targetFps, 24)
    XCTAssertEqual(resolve(tier: .high).targetFps, 30)
  }

  func testAutoRidesTheMeasuredRateOnceThereIsOne() {
    XCTAssertEqual(resolve(tier: .high, autoFps: 34).targetFps, 34)
    XCTAssertEqual(resolve(profile: .unrestricted, autoFps: 34).targetFps, 34)
  }

  func testANamedProfileIgnoresTheMeasuredRate() {
    XCTAssertEqual(resolve(profile: .efficient, autoFps: 34).targetFps, 15)
    XCTAssertEqual(resolve(profile: .quality, autoFps: 12).targetFps, 30)
  }

  func testAnExplicitFpsOutranksTheMeasuredRate() {
    XCTAssertEqual(resolve(autoFps: 34, fps: 24).targetFps, 24)
  }

  func testHeatScalesTheMeasuredRateLikeAnyOther() {
    XCTAssertEqual(resolve(autoFps: 33, thermal: .fair).targetFps, 24)
  }

  func testANamedProfilePinsItsTierAndIgnoresWhatWasMeasured() {
    let efficient = resolve(profile: .efficient, tier: .high)
    XCTAssertEqual(efficient.targetFps, 15)
    XCTAssertEqual(efficient.preview, "480p")
    XCTAssertEqual(efficient.analysis, "360p")

    let quality = resolve(profile: .quality, tier: .low)
    XCTAssertEqual(quality.targetFps, 30)
    XCTAssertEqual(quality.preview, "1080p")
  }

  func testAnExplicitPropOutranksTheProfileOnItsOwnAxisOnly() {
    let resolved = resolve(profile: .quality, fps: 12, analysis: "360p")

    XCTAssertEqual(resolved.targetFps, 12, "pinned")
    XCTAssertEqual(resolved.analysis, "360p", "pinned")
    XCTAssertEqual(resolved.preview, "1080p", "still the profile's")
  }

  func testHeatOutranksEverythingTheProfileAndThePropsAskedFor() {
    XCTAssertEqual(resolve(profile: .quality, fps: 40).targetFps, 40)
    XCTAssertEqual(resolve(profile: .quality, fps: 40, thermal: .fair).targetFps, 30)

    let serious = resolve(profile: .quality, fps: 40, thermal: .serious)
    XCTAssertEqual(serious.targetFps, 20)
    XCTAssertEqual(serious.analysis, "360p", "one step down the analysis ladder")

    XCTAssertTrue(resolve(thermal: .critical).detectionPaused)
  }

  func testThermalPolicyOffStopsTheResponseAndReportingIsNotThisResolversJob() {
    XCTAssertEqual(resolve(thermal: .serious, policy: .off).targetFps, 24)
    XCTAssertFalse(resolve(thermal: .critical, policy: .off).detectionPaused)
  }

  func testCriticalOnlyIgnoresEverythingBelowCritical() {
    XCTAssertEqual(resolve(thermal: .serious, policy: .criticalOnly).targetFps, 24)
    XCTAssertTrue(resolve(thermal: .critical, policy: .criticalOnly).detectionPaused)
  }

  func testUnrestrictedOptsOutOfTheLadderButNotOutOfCritical() {
    XCTAssertEqual(
      resolve(profile: .unrestricted, thermal: .serious).targetFps,
      24,
      "a device about to shut down is not a preference anyone can hold"
    )
    XCTAssertTrue(resolve(profile: .unrestricted, thermal: .critical).detectionPaused)
  }

  func testAScaledFrameRateNeverReachesZeroWhichWouldReadAsUnlimited() {
    XCTAssertEqual(resolve(fps: 1, thermal: .serious).targetFps, 1)
  }
}
