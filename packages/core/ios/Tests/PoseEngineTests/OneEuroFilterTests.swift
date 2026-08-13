import XCTest
@testable import PoseEngine

final class OneEuroFilterTests: XCTestCase {
  private let filter = OneEuroFilter()
  private let step: Float = 1.0 / 30.0

  private func frame(_ posX: Float, _ posY: Float = 0.5) -> [Float] {
    var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
    for joint in 0..<Skeleton.landmarkCount {
      let base = joint * Skeleton.landmarkStride
      landmarks[base] = posX
      landmarks[base + 1] = posY
      landmarks[base + 2] = 0
      landmarks[base + 3] = 0.9
    }
    return landmarks
  }

  func testTheFirstFramePassesThroughBecauseThereIsNothingToFilterAgainst() {
    var first = frame(0.42)
    filter.apply(to: &first, elapsedSeconds: step)
    XCTAssertEqual(first[0], 0.42)
  }

  func testVisibilityIsNeverSmoothed() {
    var seed = frame(0.5)
    filter.apply(to: &seed, elapsedSeconds: step)

    var next = frame(0.5)
    next[Skeleton.landmarkStride - 1] = 0.1
    filter.apply(to: &next, elapsedSeconds: step)

    // A joint that has just left frame must not keep reading as present.
    XCTAssertEqual(next[Skeleton.landmarkStride - 1], 0.1)
  }

  func testJitterAroundAStillPositionIsReduced() {
    filter.configure(minCutoff: 0.5, beta: 0)
    var seed = frame(0.5)
    filter.apply(to: &seed, elapsedSeconds: step)

    var rawSwing: Float = 0
    var filteredSwing: Float = 0

    for tick in 1...60 {
      let noise: Float = tick.isMultiple(of: 2) ? 0.02 : -0.02
      let raw = 0.5 + noise
      var landmarks = frame(raw)
      filter.apply(to: &landmarks, elapsedSeconds: step)

      rawSwing += abs(raw - 0.5)
      filteredSwing += abs(landmarks[0] - 0.5)
    }

    XCTAssertLessThan(filteredSwing, rawSwing / 2, "filtered swing should be well under raw")
  }

  func testBetaLetsFastMovementThroughThatAFixedCutoffWouldLag() {
    func lagOf(beta: Float) -> Float {
      let filter = OneEuroFilter()
      filter.configure(minCutoff: 0.5, beta: beta)

      var landmarks = frame(0)
      filter.apply(to: &landmarks, elapsedSeconds: step)

      var position: Float = 0
      for _ in 0..<20 {
        position += 0.05
        landmarks = frame(position)
        filter.apply(to: &landmarks, elapsedSeconds: step)
      }
      return abs(position - landmarks[0])
    }

    XCTAssertLessThan(lagOf(beta: 1), lagOf(beta: 0), "a higher beta must track faster")
  }

  func testAnUnknownIntervalLeavesTheFrameAloneRatherThanDividingByIt() {
    var seed = frame(0.5)
    filter.apply(to: &seed, elapsedSeconds: step)

    var landmarks = frame(0.9)
    filter.apply(to: &landmarks, elapsedSeconds: .nan)
    XCTAssertEqual(landmarks[0], 0.9, "untouched, not filtered against nothing")
  }

  func testAResetMakesTheNextFrameTheFirstOneAgain() {
    filter.configure(minCutoff: 0.1, beta: 0)
    var seed = frame(0)
    filter.apply(to: &seed, elapsedSeconds: step)
    for _ in 0..<10 {
      var landmarks = frame(0)
      filter.apply(to: &landmarks, elapsedSeconds: step)
    }

    filter.reset()
    var afterReset = frame(0.8)
    filter.apply(to: &afterReset, elapsedSeconds: step)

    XCTAssertEqual(afterReset[0], 0.8, "no filtering across a discontinuity")
  }

  func testACutoffOfZeroWouldDivideByZeroSoItIsRefused() {
    filter.configure(minCutoff: 0, beta: -1)

    XCTAssertEqual(filter.minCutoff, OneEuroFilter.defaultMinCutoff)
    XCTAssertEqual(filter.beta, OneEuroFilter.defaultBeta)
  }

  func testASmoothedSignalFollowsARealMovementRatherThanFlatteningIt() {
    filter.configure(minCutoff: 1, beta: 0.5)

    var landmarks = frame(0.5)
    filter.apply(to: &landmarks, elapsedSeconds: step)

    var last: Float = 0
    for tick in 1...90 {
      let truth = 0.5 + 0.3 * sin(Float(tick) / 15)
      landmarks = frame(truth)
      filter.apply(to: &landmarks, elapsedSeconds: step)
      last = abs(landmarks[0] - truth)
    }

    XCTAssertLessThan(last, 0.1, "a lag of \(last) is not following the signal")
  }
}
