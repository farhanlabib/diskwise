class Macsweep < Formula
  desc "Explains where your Mac's disk space went and only deletes what is provably safe"
  homepage "https://github.com/farhanlabib/macsweep"
  url "https://github.com/farhanlabib/macsweep/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on :macos
  depends_on "node"
  depends_on "pnpm" => :build
  depends_on xcode: :build

  def install
    system "pnpm", "install", "--frozen-lockfile"
    system "packages/native-helper/build.sh"
    system "pnpm", "-F", "@macsweep/ui", "build"
    system "pnpm", "-F", "macsweep", "build"

    libexec.install Dir["packages/cli/dist/*"]

    (bin/"macsweep").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/index.js" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/macsweep --version")
  end
end
