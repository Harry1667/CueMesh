# Optional GitHub Actions workflow

`github-actions.website.yml` is a template, not an active repository workflow. The repository owner can review and copy it to `.github/workflows/website.yml`. It stays inside `website/` here to preserve the module ownership rule.

It uses read-only repository permissions and runs type, contract, format, test, and production-build checks. It does not deploy or require secrets. The action major versions follow the current official examples for [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node); the owner can pin reviewed commit SHAs according to repository policy.

No GitHub Actions run has been observed for this template. The local checks and their limits are recorded in `../docs/VALIDATION.md`.
