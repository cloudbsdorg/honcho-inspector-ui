#!/usr/bin/env python3
"""Patch fpm 1.17's apk.rb cut_tar_record to a no-op.

Newer Ruby's stdlib tar generator omits the 1KB end-of-archive
marker, but fpm's apk.rb raises "Invalid tar stream, eof before
end-of-tar record" when scanning for it. Replace the buggy scan
loop with a simple file copy so the cut stops at the actual end
of file. (Fixed in fpm upstream; revisit when a release lands.)
"""
import re
import sys

if len(sys.argv) != 2:
    print("usage: patch-fpm-apk.py <apk.rb>", file=sys.stderr)
    sys.exit(1)

target = sys.argv[1]
src = open(target).read()
new_body = """  def cut_tar_record(target_path)
    FileUtils.cp(target_path, target_path + '~')
    FileUtils.mv(target_path + '~', target_path)
  end"""
# Match the cut_tar_record method definition through its matching
# `end` at the SAME indent level. fpm apk.rb uses 2-space indent for
# top-level methods, 4-space for nested blocks. We anchor on the
# `  end` (2-space) at column 0 to ensure the regex doesn't swallow
# nested `end`s inside do..end blocks. The pattern is intentionally
# anchored to require a trailing newline before the end so nested
# do..end blocks (which close with `\n    end`) don't match.
new_src, count = re.subn(
    r"  def cut_tar_record\(target_path\)(?:.|\n)*?\n  end\n",
    new_body + "\n",
    src, count=1,
)
if count != 1:
    print(f"ERROR: cut_tar_record not found in {target}", file=sys.stderr)
    sys.exit(1)
open(target, 'w').write(new_src)
print(f"patched {target}")
print("found", count, "match(es)")
