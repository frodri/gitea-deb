import { readFile, rm, mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { exec as execImpl } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execImpl);

const main = async () => {
    // Look up release data.
    const releaseRequest = await fetch('https://api.github.com/repos/go-gitea/gitea/releases/latest');
    const releaseData = await releaseRequest.json();

    const newVersion = releaseData.tag_name.substring(1);
    const currentVersionFile = await readFile('current.txt');
    const currentVersion = currentVersionFile.toString();

    if (currentVersion === newVersion) {
        console.log('Version match. Exiting.');
        return;
    }

    // Ensure that no output from an older build remains.
    const workingFolders = ['deb', 'tmp'];
    const folderRemovals = workingFolders.map(
        (dir) => rm(dir, {recursive: true, force:true})
    );
    await Promise.all(folderRemovals);

    const serviceRequest = fetch(
        `https://raw.githubusercontent.com/go-gitea/gitea/master/contrib/systemd/gitea.service`
    );

    const newFolders = [
        "./deb",
        "./tmp/usr/local/bin",
        './tmp/etc/systemd/system',
        "./tmp/var/lib/gitea/custom",
        "./tmp/var/lib/gitea/data",
        "./tmp/var/lib/gitea/indexers",
        "./tmp/var/lib/gitea/public",
        "./tmp/var/lib/gitea/log",
    ];

    let folderMkdirs = newFolders.map(
        (folder) => mkdir(folder, {recursive: true, mode: 0o750})
    )
    folderMkdirs.push(
        mkdir('./tmp/etc/gitea', {recursive: true, mode: 0o770}),
        mkdir('./tmp/DEBIAN', {recursive: true, mode: 0o755})
    );
    await Promise.all(folderMkdirs);

    // Copy files.
    const DEBIANfiles = ['postinst', 'postrm', 'preinst', 'prerm'];
    let fileWrites = DEBIANfiles.map(
        (file) => copyFile(`DEBIAN/${file}`, `tmp/DEBIAN/${file}`)
    );
    const serviceResponse = await serviceRequest;
    const serviceBuffer = Buffer.from(await serviceResponse.arrayBuffer());
    fileWrites.push(
        writeFile('./tmp/etc/systemd/system/gitea.service', serviceBuffer, {mode: 0x755})
    );
    await Promise.all(fileWrites);

    // Fix file permissions for dpkg.
    const fileChmods =  DEBIANfiles.map(
        (file) => chmod(`./tmp/DEBIAN/${file}`, 0o755)
    );
    await Promise.all(fileChmods);

    const DEBIANcontrolFile = await readFile('DEBIAN/control');
    const DEBIANcontrolData = DEBIANcontrolFile.toString();

    const architectures = ['386','amd64','arm-6','arm64'];

    for (let architecture of architectures) {
        const binaryUrl = `https://github.com/go-gitea/gitea/releases/download/v${newVersion}/gitea-${newVersion}-linux-${architecture}`;
        console.log(binaryUrl);
        const binaryRequest = fetch(binaryUrl);
        const binaryResponse = await binaryRequest;
        const binaryBuffer = Buffer.from(await binaryResponse.arrayBuffer());
        const binaryWriter = writeFile(
            './tmp/usr/local/bin/gitea',
            binaryBuffer,
            {mode: 0x755, flag: 'w'}
        );

        architecture = architecture === 'arm-6' ? 'armhf' : architecture;
        architecture = architecture === '386' ? 'i386' : architecture;

        let editedControlData = DEBIANcontrolData.replaceAll(
            'VERSION-TO-REPLACE',
            newVersion
        );
        editedControlData = editedControlData.replaceAll(
            'ARCHI-TO-REPLACE',
            architecture
        );
        await writeFile(
            'tmp/DEBIAN/control',
            editedControlData, 
            {mode: 0o755, flag: 'w'}
        );
        await binaryWriter;
        await exec('dpkg-deb --build tmp deb');
        await rm('./tmp/usr/local/bin/gitea');
    }

    // Update the version number.
    await writeFile('current.txt', newVersion);
}

main().catch(console.error);