# Shipped to consuming apps through `consumerProguardFiles`. React Native's release template turns
# on minifyEnabled, and nothing in the MediaPipe AARs carries keep rules of its own, so without
# these R8 is free to strip or rename classes the native side looks up by name. The failure only
# appears in a release build, which is after the developer has shipped.

# tasks-core reaches its option, proto and result classes from JNI and by reflection.
-keep class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**

# The protobuf runtime MediaPipe bundles resolves generated message classes by name.
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**

# The JNI bindings are matched by name, so the methods have to keep the ones they were built with.
-keepclasseswithmembernames class * {
    native <methods>;
}
