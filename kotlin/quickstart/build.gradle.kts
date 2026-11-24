plugins {
    kotlin("jvm") version "2.3.20"
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("xyz.audren:audren-sdk-kotlin:1.3.0")
    implementation("org.json:json:20250107")
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("MainKt")
}

tasks.named<JavaExec>("run") {
    val audrenRepo = System.getenv("AUDREN_REPO_DIR")
        ?: file("../../../audren").canonicalPath
    val ffiLibDir = System.getenv("AUDREN_FFI_LIB_DIR")
        ?: "$audrenRepo/target/release"
    systemProperty("jna.library.path", ffiLibDir)
    environment("AUDREN_REPO_DIR", audrenRepo)
}
