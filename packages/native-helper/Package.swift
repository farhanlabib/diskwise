// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "macsweep-helper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "macsweep-helper",
            path: "Sources/macsweep-helper"
        )
    ]
)
