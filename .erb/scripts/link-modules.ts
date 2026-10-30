import fs from 'fs';
import path from 'path';
import webpackPaths from '../configs/webpack.paths';

const { srcNodeModulesPath, appNodeModulesPath, erbNodeModulesPath } =
  webpackPaths;

function markPtyHelpersExecutable(): void {
  const ptyDir = path.join(appNodeModulesPath, 'node-pty');
  const prebuildsDir = path.join(ptyDir, 'prebuilds');
  const helpers = [
    path.join(ptyDir, 'build', 'Release', 'spawn-helper'),
    ...(fs.existsSync(prebuildsDir)
      ? fs
          .readdirSync(prebuildsDir)
          .map((platform) =>
            path.join(ptyDir, 'prebuilds', platform, 'spawn-helper'),
          )
      : []),
  ];
  helpers.forEach((helper) => {
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  });
}

if (fs.existsSync(appNodeModulesPath)) {
  markPtyHelpersExecutable();
  if (!fs.existsSync(srcNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, 'junction');
  }
  if (!fs.existsSync(erbNodeModulesPath)) {
    fs.symlinkSync(appNodeModulesPath, erbNodeModulesPath, 'junction');
  }
}
