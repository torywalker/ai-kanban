import fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { dependencies } from '../../package.json';

if (dependencies) {
  const dependenciesKeys = Object.keys(dependencies);
  const nativeDeps = fs
    .readdirSync('node_modules')
    .filter((folder) => fs.existsSync(`node_modules/${folder}/binding.gyp`));
  if (nativeDeps.length === 0) {
    process.exit(0);
  }
  try {
    // Find the reason for why the dependency is installed. If it is installed
    // because of a devDependency then that is okay. Warn when it is installed
    // because of a dependency
    // pnpm prints a one-element array; keep the object shape too in case the
    // command is ever wrapped by something that emits npm's format.
    const listed = JSON.parse(
      execSync(`pnpm ls ${nativeDeps.join(' ')} --json --depth 0`).toString(),
    );
    const dependenciesObject =
      (Array.isArray(listed) ? listed[0] : listed)?.dependencies ?? {};
    const rootDependencies = Object.keys(dependenciesObject);
    const filteredRootDependencies = rootDependencies.filter((rootDependency) =>
      dependenciesKeys.includes(rootDependency),
    );
    if (filteredRootDependencies.length > 0) {
      const plural = filteredRootDependencies.length > 1;
      console.log(`
 ${chalk.whiteBright.bgYellow.bold(
   'Webpack does not work with native dependencies.',
 )}
${chalk.bold(filteredRootDependencies.join(', '))} ${
        plural ? 'are native dependencies' : 'is a native dependency'
      } and should be installed inside of the "./release/app" folder.
 First, uninstall the packages from "./package.json":
${chalk.whiteBright.bgGreen.bold('pnpm remove your-package')}
 ${chalk.bold(
   'Then, instead of installing the package to the root "./package.json":',
 )}
${chalk.whiteBright.bgRed.bold('pnpm add your-package')}
 ${chalk.bold('Install the package to "./release/app/package.json"')}
${chalk.whiteBright.bgGreen.bold(
  'pnpm --dir release/app add your-package',
)}
 Read more about native dependencies at:
${chalk.bold(
  'https://electron-react-boilerplate.js.org/docs/adding-dependencies/#module-structure',
)}
 `);
      process.exit(1);
    }
  } catch {
    console.log('Native dependencies could not be checked');
  }
}
