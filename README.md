# OunceCake

(`ozdumptool` if you're ***lame*** and ***boring***) 

Tool to dump unencrypted romFS and exeFS for Switch 2 games, updates and DLC.

Supports digital games, game cards, Switch 2 Editions, etc.
(For NSO titles, make sure the title has been opened recently before you attempt to mount it, otherwise the mount will fail.)

## Disclaimer

For the love of God, do NOT share any files you rip using this tool. It is to be used with ONLY your own games on your OWN system. This tool doesn't provide system keys or any method to decrypt files. The files are loaded normally by the system, then pulled over FTP.

## Usage

0. Take note of your Switch 2's local IP address. It can be found in the network settings.

1. Clone the repo: 
``` 
git clone https://github.com/misshexa66/OunceCake.git
```

2. Use kurumuz's fork of the [ns2jb exploit](https://gitlab.com/kurumuz/ns2jb) to get an RPC connection with the system. Use `node run.cjs --rpc`.

3. Run `node ouncecake.cjs <path-to-ns2jb-run>`. The output from ns2jb will tell you where this path is. (`Run folder: /home/hexa/projects/ns2jb2/runs/switch2-Icu7Jd`)

4. OunceCake will prompt you to pick a game. Pick one, then wait.

5. When OunceCake says `FTP up! ftp://<switch 2 ip>:2121`, use an FTP client to connect to your Switch 2's local IP address with port 2121. A username and password is not required. (Make sure your FTP client has its transfer mode set to Binary/Image/TYPE I.)

## Tar Mode

OunceCake now has support for showing game data as .tar files instead of raw folders, allowing for faster downloading. Add `--tar` to the launch args.

## Update versions

By default, OunceCake mounts only the newest discovered version of each update across internal storage, SD and game card. All programs in that version are included, including Switch 2 Edition content. The base game and DLC are still exposed.

Merged update filesystems stay open for FTP. Mounting older versions alongside the newest one adds console resource usage; [issue #10](https://github.com/misshexa66/OunceCake/issues/10) reports a Z-A crash while opening an older update after the newer version. Selecting one version avoids that mounting sequence in both normal and tar mode. The console crash still needs hardware verification.

To dump another discovered version in a separate session, use its decimal version number:

```sh
node ouncecake.cjs <path-to-ns2jb-run> --update-version 65536
```

Stop OunceCake with Ctrl-C before starting the next session. An unavailable version produces an error before any game content is mounted.

## Licensing

OunceCake is licensed under the terms of the GPLv2 (because it borrows a tiny bit of code from [Atmosphere](https://github.com/Atmosphere-NX/Atmosphere))

You can find a copy of the license in the LICENSE file.
