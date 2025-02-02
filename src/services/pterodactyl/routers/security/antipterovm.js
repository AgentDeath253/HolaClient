/**
 *--------------------------------------------------------------------------
 *   _    _       _        _____ _ _            _   
 * | |  | |     | |      / ____| (_)          | |  
 * | |__| | ___ | | __ _| |    | |_  ___ _ __ | |_ 
 * |  __  |/ _ \| |/ _` | |    | | |/ _ \ '_ \| __|
 * | |  | | (_) | | (_| | |____| | |  __/ | | | |_ 
 * |_|  |_|\___/|_|\__,_|\_____|_|_|\___|_| |_|\__|
 *--------------------------------------------------------------------------
 *
 * @author CR072 <crazymath072@holaclient.tech>
 * @license Apache-2.0
 * 
 * https://holaclient.tech
 * 
 * © 2022-2024 HolaClient
 *
 *--------------------------------------------------------------------------
 * antivm.js - Security feature to suspend servers running PteroVM
 *--------------------------------------------------------------------------
*/

/**
 *--------------------------------------------------------------------------
 * Loading modules
 *--------------------------------------------------------------------------
*/
const modules = require("../../../../utils/modules");
const page = modules.page;
const core = modules.core
const fetch = modules.fetch;
const chalk = modules.chalk;
const wh = modules.wh;
module.exports.load = async function (app, db) {
    const pterodactyl = await db.get('pterodactyl', 'settings')
    const settings = await modules.settings
    const panelUrl = pterodactyl.domain;
    const panelApiKey = pterodactyl.app;
    const panelUserKey = pterodactyl.acc;
    const scanInterval = settings.features.anti_pteroVM.interval * 60 * 1000;
    const susFiles = settings.features.anti_pteroVM.level
    let susFilesRm;
    if (susFiles == "low") {
        susFilesRm = 4
    } else if (susFiles == "medium") {
        susFilesRm = 3
    } else if (susFiles == "high") {
        susFilesRm = 2
    } else if (susFiles == "strict") {
        susFilesRm = 1
    } else {
        susFilesRm = 3
    }
    async function suspendServer(serverId, serverName, serverOwner, serverI, numFilesMatched) {
        try {
            console.log(
                chalk.cyan("[") +
                chalk.white("HolaClient AntiVM") +
                chalk.cyan("]") +
                chalk.white(` Suspending server ${serverName}...`)
            );

            const description = numFilesMatched > susFilesRm
                ? `Server suspended by HolaClient (${numFilesMatched} suspicious files found). High chances of PteroVM or any other malicious software.`
                : `Server checked by HolaClient. No action taken.`;

            const serverDetailsResponse = await fetch(
                `${panelUrl}/api/application/servers/${serverI}/details`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${panelApiKey}`,
                        "Content-Type": "application/json",
                        Accept: "application/vnd.pterodactyl.v1+json",
                    },
                    body: JSON.stringify({
                        name: serverName,
                        user: serverOwner,
                        description: description,
                    }),
                }
            );

            if (!serverDetailsResponse.ok) {
                throw new Error(
                    `Failed to update server details for server with ID ${serverId}: ${serverDetailsResponse.status} ${serverDetailsResponse.statusText}`
                );
            }

            if (numFilesMatched > 2) {
                const suspendResponse = await fetch(
                    `${panelUrl}/api/application/servers/${serverI}/suspend`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${panelApiKey}`,
                            "Content-Type": "application/json",
                            Accept: "application/vnd.pterodactyl.v1+json",
                        },
                    }
                );

                if (!suspendResponse.ok) {
                    throw new Error(
                        `Failed to suspend server with ID ${serverId}: ${suspendResponse.status} ${suspendResponse.statusText}`
                    );
                }
            }
            wh(
                `security`,
                `${serverName} has been suspended due to PteroVM`
            );
            console.log(
                chalk.cyan("[") +
                chalk.white("HolaClient AntiVM") +
                chalk.cyan("]") +
                chalk.white(` Server ${serverName} suspended successfully.`)
            );
        } catch (error) {
            console.error(`Failed to suspend server with ID ${serverId}:`, error);
        }
    }

    async function scanServerFiles(serverId, serverName, serverOwner, serverI) {
        try {
            const serverFilesResponse = await fetch(
                `${panelUrl}/api/client/servers/${serverId}/files/list`,
                {
                    headers: {
                        Authorization: `Bearer ${panelUserKey}`,
                        Accept: "application/vnd.pterodactyl.v1+json",
                    },
                }
            );

            if (!serverFilesResponse.ok) {
                throw new Error(
                    `Failed to retrieve files for server with ID ${serverId}: ${serverFilesResponse.status} ${serverFilesResponse.statusText}`
                );
            }

            const serverFilesData = await serverFilesResponse.json();
            const files = serverFilesData.data;

            const suspiciousFileNames = [
                "st.sh", "lib32", "lib64", "proot", "mnd", "dev",
                "var", "sbin", "usr", "boot", "libx32", "start.sh"
            ];

            const foundFiles = files.filter(file =>
                suspiciousFileNames.includes(file.attributes.name)
            );

            if (foundFiles.length > susFilesRm) {
                await suspendServer(serverId, serverName, serverOwner, serverI, foundFiles.length);
            }
        } catch (error) {
            console.error(`Failed to scan files for server with ID ${serverId}:`, error);
        }
    }

    async function scanServers(res) {
        try {
            console.log(" ");
            console.log(
                chalk.gray("[⛏️] ") +
                chalk.cyan("[") +
                chalk.white("HolaClient") +
                chalk.cyan("]") +
                chalk.white(" Scanning servers for Ptero-VM...")
            );
            const serversResponse = await fetch(
                `${panelUrl}/api/application/servers`,
                {
                    headers: {
                        Authorization: `Bearer ${panelApiKey}`,
                        Accept: "application/vnd.pterodactyl.v1+json",
                    },
                }
            );

            if (!serversResponse.ok) {
                throw new Error(
                    `Failed to retrieve server list: ${serversResponse.status} ${serversResponse.statusText}`
                );
            }

            const serversData = await serversResponse.json();
            const servers = serversData.data;

            for (const server of servers) {
                const serverId = server.attributes.identifier;
                const serverI = server.attributes.id;
                const serverName = server.attributes.name;
                const serverOwner = server.attributes.user;
                await scanServerFiles(serverId, serverName, serverOwner, serverI);
            }

            console.log(" ");
            console.log(
                chalk.gray("[✅]") +
                chalk.cyan("[") +
                chalk.white("HolaClient") +
                chalk.cyan("]") +
                chalk.white(" Finished scanning for Ptero-VM servers!")
            );
            await db.set('pterodactyl', 'antivm', Date.now())
        } catch (error) {
            console.error("Failed to retrieve server list:", error);
        }
    }

    if (settings.features.anti_pteroVM.enabled == true) {
        setInterval(scanServers, scanInterval);
    } else {
        return;
    }

    app.get("/api/admin/pterovm", core.auth, async (req, res) => {
        let a = await db.get("pterodactyl", 'antivm') ?? ""
        res.json(a);
    })
    if (settings.features.anti_pteroVM.enabled == true) {
        app.get("/api/admin/pterovm/init", core.auth, async (req, res) => {
            try {
                scanServers(res)
                res.json({ success: true })
            } catch (error) {
                console.log(error)
                res.json({ success: false, error })
            }
        })
    }
};