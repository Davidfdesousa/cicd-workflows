/**
 * semantic-release · TOKENS repository
 *
 *   fix: → patch · feat: → minor · feat!: / BREAKING CHANGE: → major
 *
 * `main` publishes stable releases (distributed to the consumers); `rc` publishes
 * `-rc.N` prereleases (not distributed, but installable on demand).
 *
 * Contract with the consumers: every release has one zip per platform, named
 * `tokens-<platform>.zip`, whose contents are copied as-is into the consumer's
 * `design-tokens/` folder. Adjust `prepareCmd` to your build.
 *
 * Dev dependencies: semantic-release, @semantic-release/changelog,
 * @semantic-release/exec, @semantic-release/git, conventional-changelog-conventionalcommits.
 */
const config = {
  branches: ['main', { name: 'rc', prerelease: true }],
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/exec',
      {
        // Builds dist/tokens/<platform>/ with the version being published, then
        // zips each folder into dist/tokens/tokens-<platform>.zip.
        prepareCmd:
          'npm run tokens:build -- --version ${nextRelease.version} && cd dist/tokens && for p in web android ios; do (cd $p && zip -qr ../tokens-$p.zip .); done',
        // Exposes the published version to the `distribute` job.
        successCmd:
          'echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT" && echo "channel=${nextRelease.channel || \'latest\'}" >> "$GITHUB_OUTPUT"',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          { path: 'dist/tokens/tokens-web.zip', label: 'Web (CSS + JSON)' },
          { path: 'dist/tokens/tokens-android.zip', label: 'Android (colors.xml)' },
          { path: 'dist/tokens/tokens-ios.zip', label: 'iOS (DesignTokens.swift)' },
        ],
      },
    ],
  ],
};

export default config;
