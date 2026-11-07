---
title: "Releases"
description: "How versions of alcyone come out, and how to follow them."
---

The version of alcyone is the version in package.json.

A release is an annotated tag `vX.Y.Z` on main. The tag starts .github/workflows/release.yml, which runs the checks of CI on the tagged commit, checks the tag against package.json, and publishes a GitHub release with the message of the tag as its notes. It then moves the tag `latest` to the release.

A deployment follows the releases with `git checkout latest`, as in [Deploy](../../getting-started/deploy/#update).
