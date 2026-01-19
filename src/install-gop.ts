import * as core from '@actions/core'
import * as semver from 'semver'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const XGO_REPO = 'https://github.com/goplus/xgo.git'
const XGO_MODULE = 'github.com/goplus/xgo/cmd/xgo'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function installGop(): Promise<void> {
  try {
    const versionSpec = resolveVersionInput() || ''
    const tagVersions = semver.rsort(fetchTags().filter(v => semver.valid(v)))
    let version: string | null = null
    if (!versionSpec || versionSpec === 'latest') {
      version = tagVersions[0]
      core.warning(`No gop-version specified, using latest version: ${version}`)
    } else {
      version = semver.maxSatisfying(tagVersions, versionSpec)
      if (!version) {
        core.warning(
          `No gop-version found that satisfies '${versionSpec}', trying branches...`
        )
        const branchVersions = fetchBranches()
        if (!branchVersions.includes(versionSpec)) {
          throw new Error(
            `No gop-version found that satisfies '${versionSpec}' in branches or tags`
          )
        }
        version = ''
      }
    }

    let checkoutVersion = ''
    if (version) {
      core.info(`Selected version ${version} by spec ${versionSpec}`)
      checkoutVersion = `v${version}`
      core.setOutput('gop-version-verified', true)
    } else {
      core.warning(
        `Unable to find a version that satisfies the version spec '${versionSpec}', trying branches...`
      )
      checkoutVersion = versionSpec
      core.setOutput('gop-version-verified', false)
    }
    const xgoDir = cloneBranchOrTag(checkoutVersion)
    install(xgoDir)
    if (version) {
      checkVersion(version)
    }
    core.setOutput('gop-version', xgoVersion())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export function selectVersion(
  versions: string[],
  versionSpec?: string
): string | null {
  const sortedVersions = semver.rsort(versions.filter(v => semver.valid(v)))
  if (!versionSpec || versionSpec === 'latest') {
    return sortedVersions[0]
  }
  return semver.maxSatisfying(sortedVersions, versionSpec)
}

function cloneBranchOrTag(versionSpec: string): string {
  // git clone https://github.com/goplus/xgo.git with tag $versionSpec to $HOME/workdir/xgo
  const workDir = path.join(os.homedir(), 'workdir')
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true })
  }
  fs.mkdirSync(workDir)
  core.info(`Cloning xgo ${versionSpec} to ${workDir} ...`)
  const cmd = `git clone --depth 1 --branch ${versionSpec} ${XGO_REPO}`
  execSync(cmd, { cwd: workDir, stdio: 'inherit' })
  core.info('xgo cloned')
  return path.join(workDir, 'xgo')
}

function install(xgoDir: string): void {
  core.info(`Installing xgo from ${xgoDir} ...`)

  // Build xgo using simplified approach
  const bin = path.join(xgoDir, 'bin')
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(bin)
  }

  // Get version from git
  const version = execSync('git describe --tags --always', {
    cwd: xgoDir,
    env: process.env
  })
    .toString()
    .trim()

  const buildDate = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)

  // Build with ldflags to embed defaultXGoRoot and version
  const ldflags = [
    `-X "github.com/goplus/xgo/env.defaultXGoRoot=${xgoDir}"`,
    `-X "github.com/goplus/xgo/env.buildVersion=${version}"`,
    `-X "github.com/goplus/xgo/env.buildDate=${buildDate}"`
  ].join(' ')

  execSync(`go build -o bin/xgo -trimpath -ldflags '${ldflags}' ./cmd/xgo`, {
    cwd: xgoDir,
    stdio: 'inherit',
    env: process.env
  })

  // Create gop symlink/copy
  const xgoBin = path.join(bin, 'xgo')
  const gopBin = path.join(bin, 'gop')
  if (process.platform === 'win32') {
    fs.copyFileSync(xgoBin, gopBin)
  } else {
    if (fs.existsSync(gopBin)) {
      fs.unlinkSync(gopBin)
    }
    fs.symlinkSync('xgo', gopBin)
  }

  core.addPath(bin)
  core.info('xgo installed')
}

function checkVersion(versionSpec: string): string {
  core.info(`Testing xgo ${versionSpec} ...`)
  const actualVersion = xgoVersion()
  if (actualVersion !== versionSpec) {
    throw new Error(
      `Installed xgo version ${actualVersion} does not match expected version ${versionSpec}`
    )
  }
  core.info(`Installed xgo version ${actualVersion}`)
  return actualVersion
}

function xgoVersion(): string {
  const out = execSync('xgo env XGOVERSION', { env: process.env })
  return out.toString().trim().replace(/^v/, '')
}

function fetchTags(): string[] {
  const cmd = `git -c versionsort.suffix=- ls-remote --tags --sort=v:refname ${XGO_REPO}`
  const out = execSync(cmd).toString()
  const versions = out
    .split('\n')
    .filter(s => s)
    .map(s => s.split('\t')[1].replace('refs/tags/', ''))
    .map(s => s.replace(/^v/, ''))
  return versions
}

function fetchBranches(): string[] {
  const cmd = `git -c versionsort.suffix=- ls-remote --heads --sort=v:refname ${XGO_REPO}`
  const out = execSync(cmd).toString()
  const versions = out
    .split('\n')
    .filter(s => s)
    .map(s => s.split('\t')[1].replace('refs/heads/', ''))
  return versions
}

function resolveVersionInput(): string | undefined {
  let version = process.env['INPUT_GOP_VERSION']
  const versionFilePath = process.env['INPUT_GOP_VERSION_FILE']

  if (version && versionFilePath) {
    core.warning(
      'Both gop-version and gop-version-file inputs are specified, only gop-version will be used'
    )
  }

  if (version) {
    return version
  }

  if (versionFilePath) {
    if (!fs.existsSync(versionFilePath)) {
      throw new Error(
        `The specified gop version file at: ${versionFilePath} does not exist`
      )
    }
    version = parseGopVersionFile(versionFilePath)
  }

  return version
}

export function parseGopVersionFile(versionFilePath: string): string {
  const contents = fs.readFileSync(versionFilePath).toString()

  if (
    path.basename(versionFilePath) === 'gop.mod' ||
    path.basename(versionFilePath) === 'gop.work'
  ) {
    const match = contents.match(/^gop (\d+(\.\d+)*)/m)
    return match ? match[1] : ''
  }

  return contents.trim()
}
