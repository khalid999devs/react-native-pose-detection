require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ReactNativePoseDetection'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.source         = { git: package['repository']['url'] }

  # React Native 0.74, the floor in `peerDependencies`, already requires 15.1.
  s.platforms      = { ios: '15.1' }
  s.swift_version  = '5.9'

  # MediaPipe ships static libraries, so anything linking it has to be static too.
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Pinned to the version the Android side resolves, see docs/adr/0007-pin-mediapipe-0-10-35.md.
  # Two evaluators required to agree cannot start from different MediaPipe versions.
  s.dependency 'MediaPipeTasksVision', '0.10.35'

  s.frameworks = 'AVFoundation', 'CoreMedia', 'CoreVideo', 'QuartzCore', 'Metal'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  # The model is not a pod resource. The config plugin and the CLI install it into the
  # application target, which is what keeps one copy in the bundle no matter how many
  # pods depend on this one. See guides/installation.md.
  s.source_files = '**/*.{h,m,mm,swift}'
  s.exclude_files = 'Package.swift', 'Tests/**/*'
end
