import CoreGraphics
import XCTest

@testable import PoseEngine

/// The output size, which decides how long an export takes and whether the encoder accepts it.
final class ExportCanvasTests: XCTestCase {

  func testACapSmallerThanTheSourceScalesBothAxesTogether() {
    let canvas = exportCanvasSize(display: CGSize(width: 3840, height: 2160), maxSize: 1920)
    XCTAssertEqual(canvas.width, 1920)
    XCTAssertEqual(canvas.height, 1080)
  }

  func testTheAspectRatioSurvivesTheCap() {
    let display = CGSize(width: 1080, height: 1920)
    let canvas = exportCanvasSize(display: display, maxSize: 720)
    XCTAssertEqual(canvas.width / canvas.height, display.width / display.height, accuracy: 0.01)
  }

  /// Otherwise a 480p clip would be painted at 1920, which is four times the encode for the same
  /// picture and a file that is larger than the thing it was made from.
  func testASourceSmallerThanTheCapIsLeftAlone() {
    let canvas = exportCanvasSize(display: CGSize(width: 640, height: 480), maxSize: 1920)
    XCTAssertEqual(canvas, CGSize(width: 640, height: 480))
  }

  func testZeroMeansTheSourcesOwnSize() {
    let canvas = exportCanvasSize(display: CGSize(width: 3840, height: 2160), maxSize: 0)
    XCTAssertEqual(canvas, CGSize(width: 3840, height: 2160))
  }

  /// H.264 rejects an odd dimension on some devices and rounds it on others.
  func testBothAxesComeBackEven() {
    for width in 1...64 {
      for height in [1, 3, 17, 99] {
        let canvas = exportCanvasSize(display: CGSize(width: width, height: height), maxSize: 0)
        XCTAssertEqual(canvas.width.truncatingRemainder(dividingBy: 2), 0, "width \(width)")
        XCTAssertEqual(canvas.height.truncatingRemainder(dividingBy: 2), 0, "height \(height)")
        XCTAssertGreaterThanOrEqual(canvas.width, 2)
        XCTAssertGreaterThanOrEqual(canvas.height, 2)
      }
    }
  }

  func testADegenerateSourceStillProducesAnEncodableSize() {
    XCTAssertEqual(exportCanvasSize(display: .zero, maxSize: 1920), CGSize(width: 2, height: 2))
    XCTAssertEqual(
      exportCanvasSize(display: CGSize(width: 100, height: 0), maxSize: 1920),
      CGSize(width: 2, height: 2)
    )
  }

  /// The cap is a long-edge cap, so it applies to height on a portrait source.
  func testThePortraitLongEdgeIsTheOneThatIsCapped() {
    let canvas = exportCanvasSize(display: CGSize(width: 1080, height: 1920), maxSize: 960)
    XCTAssertEqual(canvas.height, 960)
    XCTAssertEqual(canvas.width, 540)
  }
}
