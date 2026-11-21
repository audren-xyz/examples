// swift-tools-version: 5.10
import Foundation
import PackageDescription

let pkgDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let defaultAudrenRepo = pkgDir
    .appendingPathComponent("../../../audren")
    .standardizedFileURL.path
let audrenRepo = ProcessInfo.processInfo.environment["AUDREN_REPO_DIR"] ?? defaultAudrenRepo
let swiftSdkPath = URL(fileURLWithPath: audrenRepo)
    .appendingPathComponent("packages/swift")
    .standardizedFileURL.path

let package = Package(
    name: "AudrenQuickstart",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    dependencies: [
        .package(path: swiftSdkPath),
    ],
    targets: [
        .executableTarget(
            name: "AudrenQuickstart",
            dependencies: [
                .product(name: "AudrenSDK", package: "swift"),
            ]
        ),
    ]
)
