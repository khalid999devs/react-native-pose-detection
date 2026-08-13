import CoreGraphics
import XCTest

@testable import PoseEngine

/**
 The picture and the skeleton are positioned from this one type, so these are the tests that say
 they cannot drift apart. Every case is a shape a real device produces: a 4:3 sensor in a tall
 view, a 16:9 clip in a square box, a portrait photo in a landscape window.
 */
final class OverlayProjectionTests: XCTestCase {
  private let bounds = CGRect(x: 0, y: 0, width: 400, height: 800)

  func testFillCoversTheViewOnAWiderSource() {
    let projection = OverlayProjection(source: CGSize(width: 1920, height: 1080), bounds: bounds, fit: .fill)

    // Cover means no gap on either axis, and the overflow is split evenly.
    XCTAssertEqual(projection.rect.height, 800, accuracy: 0.001)
    XCTAssertEqual(projection.rect.width, 800 * 16 / 9, accuracy: 0.001)
    XCTAssertEqual(projection.rect.minX, (400 - 800 * 16 / 9) / 2, accuracy: 0.001)
    XCTAssertEqual(projection.rect.minY, 0, accuracy: 0.001)
  }

  func testFitShowsTheWholeSourceOnAWiderSource() {
    let projection = OverlayProjection(source: CGSize(width: 1920, height: 1080), bounds: bounds, fit: .fit)

    // Fit means nothing is cropped, so the wider axis is the one that touches the edges.
    XCTAssertEqual(projection.rect.width, 400, accuracy: 0.001)
    XCTAssertEqual(projection.rect.height, 400 * 9 / 16, accuracy: 0.001)
    XCTAssertEqual(projection.rect.minX, 0, accuracy: 0.001)
    XCTAssertEqual(projection.rect.minY, (800 - 400 * 9 / 16) / 2, accuracy: 0.001)
  }

  func testFitAndFillAgreeWhenTheAspectsMatch() {
    let source = CGSize(width: 200, height: 400)
    let fill = OverlayProjection(source: source, bounds: bounds, fit: .fill)
    let fit = OverlayProjection(source: source, bounds: bounds, fit: .fit)

    XCTAssertEqual(fill, fit)
    XCTAssertEqual(fill.rect, bounds)
  }

  func testFitNeverExceedsTheBounds() {
    for source in [CGSize(width: 4000, height: 10), CGSize(width: 10, height: 4000), CGSize(width: 640, height: 480)] {
      let rect = OverlayProjection(source: source, bounds: bounds, fit: .fit).rect
      XCTAssertLessThanOrEqual(rect.width, bounds.width + 0.001, "\(source)")
      XCTAssertLessThanOrEqual(rect.height, bounds.height + 0.001, "\(source)")
    }
  }

  func testFillNeverLeavesAGap() {
    for source in [CGSize(width: 4000, height: 10), CGSize(width: 10, height: 4000), CGSize(width: 640, height: 480)] {
      let rect = OverlayProjection(source: source, bounds: bounds, fit: .fill).rect
      XCTAssertGreaterThanOrEqual(rect.width, bounds.width - 0.001, "\(source)")
      XCTAssertGreaterThanOrEqual(rect.height, bounds.height - 0.001, "\(source)")
    }
  }

  func testCornersOfTheSourceLandOnCornersOfTheContentRect() {
    let projection = OverlayProjection(source: CGSize(width: 1920, height: 1080), bounds: bounds, fit: .fit)

    // A landmark at 0,0 is the top-left of the picture, not of the view. This is the assertion
    // that the letterbox is accounted for.
    let topLeft = projection.point(x: 0, y: 0, mirrored: false)
    let bottomRight = projection.point(x: 1, y: 1, mirrored: false)

    XCTAssertEqual(topLeft.x, projection.rect.minX, accuracy: 0.001)
    XCTAssertEqual(topLeft.y, projection.rect.minY, accuracy: 0.001)
    XCTAssertEqual(bottomRight.x, projection.rect.maxX, accuracy: 0.001)
    XCTAssertEqual(bottomRight.y, projection.rect.maxY, accuracy: 0.001)
  }

  func testMirroringFlipsXAndLeavesYAlone() {
    let projection = OverlayProjection(source: CGSize(width: 1080, height: 1920), bounds: bounds, fit: .fill)

    let plain = projection.point(x: 0.25, y: 0.75, mirrored: false)
    let mirrored = projection.point(x: 0.25, y: 0.75, mirrored: true)

    XCTAssertEqual(mirrored.y, plain.y, accuracy: 0.001)
    // The two land equidistant from the centre of the picture, not of the view.
    XCTAssertEqual((plain.x + mirrored.x) / 2, projection.rect.midX, accuracy: 0.001)
  }

  func testMirroringIsItsOwnInverse() {
    let projection = OverlayProjection(source: CGSize(width: 640, height: 480), bounds: bounds, fit: .fit)
    let once = projection.point(x: 0.3, y: 0.6, mirrored: true)
    let plain = projection.point(x: 1 - 0.3, y: 0.6, mirrored: false)

    XCTAssertEqual(once.x, plain.x, accuracy: 0.001)
  }

  func testADegenerateSourceFallsBackToTheBoundsRatherThanDividingByZero() {
    for source in [CGSize(width: 0, height: 100), CGSize(width: 100, height: 0), CGSize.zero] {
      XCTAssertEqual(OverlayProjection(source: source, bounds: bounds, fit: .fit).rect, bounds, "\(source)")
    }
  }

  func testADegenerateBoundsIsNotProjectedInto() {
    let empty = CGRect(x: 0, y: 0, width: 0, height: 400)
    XCTAssertEqual(OverlayProjection(source: CGSize(width: 16, height: 9), bounds: empty, fit: .fit).rect, empty)
  }

  func testAnOffsetBoundsIsHonoured() {
    // The overlay is always at the origin today, but a projection that ignored minX would be a
    // bug waiting for the first time it is not.
    let offset = CGRect(x: 50, y: 20, width: 400, height: 800)
    let projection = OverlayProjection(source: CGSize(width: 400, height: 800), bounds: offset, fit: .fit)

    XCTAssertEqual(projection.rect, offset)
    XCTAssertEqual(projection.point(x: 0, y: 0, mirrored: false), CGPoint(x: 50, y: 20))
  }
}
