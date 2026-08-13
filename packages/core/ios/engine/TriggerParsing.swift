import Foundation

let defaultWhileThrottleMs: Int64 = 250

/**
 JavaScript validates every trigger before native sees one, so this half is lenient by design:
 what it cannot read becomes a condition that never matches, and says so in the log rather than
 failing a camera over a config the validator already approved.
 */
func parseTriggers(_ raw: [Any]?) -> [TriggerSpec] {
  guard let raw = raw, !raw.isEmpty else { return [] }

  var specs = [TriggerSpec]()
  specs.reserveCapacity(raw.count)

  for entry in raw {
    guard let map = JS.dictionary(entry), let id = JS.string(map["id"]) else { continue }
    let enter = parseCondition(map["enter"])
    // Absent means "when `enter` stops holding". A JavaScript null arrives as NSNull rather than
    // as a missing key, and reading that as a condition would make it one that never matches.
    let rawExit = map["exit"]
    let exit: any PoseCondition = JS.isNull(rawExit) ? NotCondition(inner: enter) : parseCondition(rawExit)

    specs.append(TriggerSpec(
      id: id,
      enter: enter,
      exit: exit,
      emit: TriggerEmit.from(JS.string(map["emit"])),
      debounceMs: duration(map["debounceMs"], 0),
      minDurationMs: duration(map["minDurationMs"], 0),
      snapshot: JS.bool(map["snapshot"]) ?? false,
      throttleMs: duration(map["throttleMs"], defaultWhileThrottleMs, floor: 1)
    ))
  }
  return specs
}

/**
 `floor` is 1 for `throttleMs`: zero would emit on every frame under a name that promises not to,
 and it would put the whole trigger payload allocation into the steady-state frame path. Debounce
 and minDuration are genuinely allowed to be zero, which means "no delay".
 */
func duration(_ value: Any?, _ fallback: Int64, floor: Int64 = 0) -> Int64 {
  guard let number = JS.number(value) else { return fallback }
  return max(Int64(number), floor)
}

func parseCondition(_ raw: Any?) -> any PoseCondition {
  guard let map = JS.dictionary(raw) else {
    PoseLog.warn(.triggers, "a condition was not an object, it will never match")
    return NeverCondition()
  }

  if let members = JS.array(map["all"]) { return AllCondition(members: parseMembers(members)) }
  if let members = JS.array(map["any"]) { return AnyCondition(members: parseMembers(members)) }

  if let joint = JS.string(map["angle"]) { return angleCondition(map, joint) }
  if let joint = JS.string(map["landmarkX"]) { return landmarkCondition(map, joint, axisX) }
  if let joint = JS.string(map["landmarkY"]) { return landmarkCondition(map, joint, axisY) }
  if let subject = JS.string(map["velocityX"]) { return velocityCondition(map, subject, axisX) }
  if let subject = JS.string(map["velocityY"]) { return velocityCondition(map, subject, axisY) }

  if let joint = JS.string(map["visibility"]) {
    guard let index = jointIndex(joint) else { return NeverCondition() }
    return VisibilityCondition(joint: index, above: bound(map["above"]))
  }

  PoseLog.warn(.triggers, "a condition named no measurement, it will never match")
  return NeverCondition()
}

func parseMembers(_ raw: [Any]) -> [any PoseCondition] {
  return raw.map(parseCondition)
}

func angleCondition(_ map: [String: Any], _ joint: String) -> any PoseCondition {
  guard let triple = Skeleton.angleTriple(joint) else {
    PoseLog.warn(.triggers, "\(joint) has no angle, its condition will never match")
    return NeverCondition()
  }
  let between = JS.array(map["between"])
  return AngleCondition(
    proximal: triple[0],
    vertex: triple[1],
    distal: triple[2],
    below: bound(map["below"]),
    above: bound(map["above"]),
    betweenMin: bound(JS.at(between, 0)),
    betweenMax: bound(JS.at(between, 1))
  )
}

func landmarkCondition(_ map: [String: Any], _ joint: String, _ axis: Int) -> any PoseCondition {
  guard let index = jointIndex(joint) else { return NeverCondition() }
  let below = map["below"]
  let above = map["above"]

  return LandmarkCondition(
    axis: axis,
    joint: index,
    below: bound(below),
    belowJoint: JS.string(below).flatMap(jointIndex) ?? noJoint,
    above: bound(above),
    aboveJoint: JS.string(above).flatMap(jointIndex) ?? noJoint
  )
}

func velocityCondition(_ map: [String: Any], _ subject: String, _ axis: Int) -> any PoseCondition {
  // `centerOfMass` is not a joint, and it is the only non-joint a velocity can name.
  var index = noJoint
  if subject != "centerOfMass" {
    guard let resolved = jointIndex(subject) else { return NeverCondition() }
    index = resolved
  }
  return VelocityCondition(axis: axis, joint: index, below: bound(map["below"]), above: bound(map["above"]))
}

func jointIndex(_ name: String) -> Int? {
  let index = Skeleton.indexOf(name)
  if index >= 0 { return index }
  PoseLog.warn(.triggers, "\(name) is not a joint, its condition will never match")
  return nil
}

/// An absent bound and an unmeasurable value are both NaN, and both mean "does not constrain".
func bound(_ value: Any?) -> Float {
  guard let number = JS.number(value) else { return .nan }
  return Float(number)
}
