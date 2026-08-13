import Foundation

/**
 Bounded, drop-oldest, written on the inference thread and drained on the module queue.

 Backing storage is allocated once per layout and reused, so the frame path copies and does not
 allocate. A drain allocates exactly one `Data`, which JavaScript then owns.
 */
final class FrameRingBuffer {
  /// Two seconds at 30 fps, which is longer than any stall a drain recovers from.
  private static let capacity = 64

  /// Unredeemed tickets past this many are overwritten. Redemption is one microtask away.
  private static let tickets = 8

  private let lock = NSLock()

  private var layout: FrameShape?
  private var stride = 0

  private var slots: [Float] = []
  private var meta: [Double] = []
  private var head = 0
  private var count = 0
  private var dropped = 0

  /// Kept whatever the mode is, so `snapshotFrame()` can answer at `mode: 'off'`.
  private var latest: [Float] = []
  private var latestTimestamp = 0.0
  private var latestProcessingMs = 0.0
  private var hasLatest = false

  /**
   Frames held for a trigger to claim, see ADR 0009. Bounded and overwritten oldest-first: a
   JavaScript side that stops redeeming must cost a fixed amount of memory, not a growing one.
   */
  private var ticketIds = [Int](repeating: 0, count: tickets)
  private var ticketFrames = [[Float]](repeating: [], count: tickets)
  private var ticketTimestamps = [Double](repeating: 0, count: tickets)
  private var ticketProcessing = [Double](repeating: 0, count: tickets)
  private var ticketCursor = 0
  private var nextTicket = 1

  /// Frames already buffered cannot be re-encoded under a new stride, so a change clears them.
  func setLayout(_ next: FrameShape) {
    lock.lock()
    defer { lock.unlock() }

    if let current = layout, current.sameAs(next) { return }

    layout = next
    stride = next.floatsPerFrame
    if slots.count != FrameRingBuffer.capacity * stride {
      slots = [Float](repeating: 0, count: FrameRingBuffer.capacity * stride)
    }
    if meta.count != FrameRingBuffer.capacity * Wire.frameMetaFloat64s {
      meta = [Double](repeating: 0, count: FrameRingBuffer.capacity * Wire.frameMetaFloat64s)
    }
    if latest.count != stride {
      latest = [Float](repeating: 0, count: stride)
    }
    if ticketFrames[0].count != stride {
      ticketFrames = [[Float]](repeating: [Float](repeating: 0, count: stride), count: FrameRingBuffer.tickets)
    }
    reset()
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    reset()
  }

  /// The pose left the frame, so there is no current frame. Buffered ones are still owed.
  func clearLatest() {
    lock.lock()
    defer { lock.unlock() }
    hasLatest = false
  }

  /// A bare header. Decodes to no frames rather than to a malformed buffer.
  func empty() -> Data {
    return WireWriter.empty()
  }

  private func reset() {
    head = 0
    count = 0
    dropped = 0
    hasLatest = false
    // A ticket minted under the old stride cannot be encoded under the new one.
    for index in ticketIds.indices {
      ticketIds[index] = 0
    }
  }

  /**
   Holds `frame` and returns the ticket that claims it. Zero means the layout is not ready, and the
   caller sends no `snapshotId` rather than one that redeems to nothing.
   */
  func mintSnapshot(_ frame: [Float], timestampMs: Double, processingMs: Double) -> Int {
    lock.lock()
    defer { lock.unlock() }
    guard stride > 0, frame.count >= stride else { return 0 }

    let ticket = nextTicket
    nextTicket += 1

    ticketIds[ticketCursor] = ticket
    copy(from: frame, into: &ticketFrames[ticketCursor])
    ticketTimestamps[ticketCursor] = timestampMs
    ticketProcessing[ticketCursor] = processingMs
    ticketCursor = (ticketCursor + 1) % FrameRingBuffer.tickets

    return ticket
  }

  /// Claims a ticket, once. An unknown or spent one is an empty buffer, never an error.
  func takeSnapshot(_ ticket: Int) -> Data {
    lock.lock()
    defer { lock.unlock() }
    guard let layout = layout, ticket != 0, let slot = ticketIds.firstIndex(of: ticket) else {
      return WireWriter.empty()
    }

    ticketIds[slot] = 0
    return encodeOne(
      layout: layout,
      frame: ticketFrames[slot],
      timestampMs: ticketTimestamps[slot],
      processingMs: ticketProcessing[slot]
    )
  }

  /**
   `buffered` is what the delivery mode decides. The latest frame is recorded either way. Returns
   nothing: a full buffer drops its oldest frame and counts it, which is reported in the next
   drain's header rather than raised here.
   */
  func submit(_ frame: [Float], timestampMs: Double, processingMs: Double, buffered: Bool) {
    lock.lock()
    defer { lock.unlock() }
    guard stride > 0, frame.count >= stride else { return }

    copy(from: frame, into: &latest)
    latestTimestamp = timestampMs
    latestProcessingMs = processingMs
    hasLatest = true

    guard buffered else { return }

    let base = head * stride
    for index in 0..<stride {
      slots[base + index] = frame[index]
    }
    meta[head * Wire.frameMetaFloat64s] = timestampMs
    meta[head * Wire.frameMetaFloat64s + 1] = processingMs

    head = (head + 1) % FrameRingBuffer.capacity
    if count == FrameRingBuffer.capacity {
      dropped += 1
    } else {
      count += 1
    }
  }

  /**
   Everything buffered since the last call. Empties the buffer and the dropped count.

   A plain `Data`, not the array buffer JavaScript receives: wrapping it is one call the caller
   makes, and keeping that out of here is what lets the encoding be tested without a JS runtime.
   */
  func drain() -> Data {
    lock.lock()
    defer { lock.unlock() }
    guard let layout = layout else { return WireWriter.empty() }

    let frames = count
    var buffer = WireWriter.allocate(shape: layout, frameCount: frames, droppedCount: dropped)

    if frames > 0 {
      let start = (head - frames + FrameRingBuffer.capacity) % FrameRingBuffer.capacity
      for index in 0..<frames {
        let slot = (start + index) % FrameRingBuffer.capacity
        WireWriter.writeMeta(
          into: &buffer,
          frameIndex: index,
          timestampMs: meta[slot * Wire.frameMetaFloat64s],
          processingMs: meta[slot * Wire.frameMetaFloat64s + 1]
        )
        WireWriter.writeFrame(
          into: &buffer,
          frameCount: frames,
          frameIndex: index,
          from: slots,
          sourceOffset: slot * stride,
          count: stride
        )
      }
    }

    count = 0
    dropped = 0
    head = 0
    return buffer
  }

  /// The most recent frame, or a bare header when no pose has been seen.
  func snapshot() -> Data {
    lock.lock()
    defer { lock.unlock() }
    guard let layout = layout, hasLatest else { return WireWriter.empty() }

    return encodeOne(
      layout: layout,
      frame: latest,
      timestampMs: latestTimestamp,
      processingMs: latestProcessingMs
    )
  }

  private func encodeOne(layout: FrameShape, frame: [Float], timestampMs: Double, processingMs: Double) -> Data {
    var buffer = WireWriter.allocate(shape: layout, frameCount: 1, droppedCount: 0)
    WireWriter.writeMeta(into: &buffer, frameIndex: 0, timestampMs: timestampMs, processingMs: processingMs)
    WireWriter.writeFrame(
      into: &buffer,
      frameCount: 1,
      frameIndex: 0,
      from: frame,
      sourceOffset: 0,
      count: stride
    )
    return buffer
  }

  private func copy(from source: [Float], into destination: inout [Float]) {
    for index in 0..<stride {
      destination[index] = source[index]
    }
  }
}
