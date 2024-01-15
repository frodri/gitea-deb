import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec as execImpl } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execImpl);

const main = async () => {
    if (!existsSync('deb')) {
        console.log('No pending releases. Exiting.');
        return;
    }

    const versionFile = await readFile('current.txt');
    const version = versionFile.toString();

    await exec(
        'git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"'
    );

    await exec(
        'git config --global user.name "github-actions[bot]"'
    );

    await exec(
        'git add current.txt'
    );

    await exec(
        `git commit -m "Gitea version updated to ${version}."`
    );

    await exec(
        'git push origin master'
    );

    await exec(
        `gh release create ${version} deb/*.deb`
    );
}

main().catch(console.error);