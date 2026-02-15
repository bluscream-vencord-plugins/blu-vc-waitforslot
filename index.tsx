export const pluginInfo = {
    id: "vcWaitForSlot",
    name: "Wait For Slot",
    description: "Multi-channel wait-for-slot functionality with high customizability.",
    color: "#7289da"
};

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Logger } from "@utils/Logger";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { registerSharedContextMenu } from "./utils/menus";
import { showNotice } from "@api/Notices";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { isVoiceChannel, isStageChannel } from "./utils/channels";
import type { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    GuildStore,
    Menu,
    SelectedChannelStore,
    ChannelActions,
    NavigationRouter,
    React,
} from "@webpack/common";
import { Button } from "@components/Button";

import { settings } from "./settings";
import { isChannelFull } from "./utils";
import { WaitPromptModal } from "./components/WaitPromptModal";
import { waitingChannels, stopWaiting } from "./state";
import { handleVoiceStateUpdates } from "./events";

import "./styles.css";

// --- Patches ---

function promptVoiceChannel(channel: Channel | null | undefined): boolean {
    if (!isVoiceChannel(channel)) return false;

    // Only intercept if full
    if (!channel.userLimit) return false;
    if (!isChannelFull(channel)) {
        return false;
    }

    if (waitingChannels.has(channel.id)) return true; // Already waiting

    openModal(modalProps => (
        <WaitPromptModal
            modalProps={modalProps}
            channel={channel}
            onWait={() => {
                waitingChannels.add(channel.id);
                // Notification that we started waiting
                if (settings.store.showNotice) {
                    showNotice(
                        React.createElement(
                            "div",
                            { className: "vc-wfs-notice" },
                            React.createElement(
                                "span",
                                { className: "vc-wfs-notice-text" },
                                `Waiting for slot in ${channel.name}...`
                            ),
                            React.createElement(
                                "div",
                                { className: "vc-wfs-notice-actions" },
                                React.createElement(
                                    Button,
                                    {
                                        size: "small",
                                        variant: "secondary",
                                        onClick: () => {
                                            const guildId = channel.guild_id ?? "@me";
                                            NavigationRouter.transitionTo(`/channels/${guildId}/${channel.id}`);
                                        }
                                    },
                                    "Jump"
                                )
                            )
                        ),
                        "Stop",
                        () => stopWaiting(channel.id)
                    );
                }
            }}
            onJump={() => {
                const guildId = channel.guild_id ?? "@me";
                NavigationRouter.transitionTo(`/channels/${guildId}/${channel.id}`);
            }}
        />
    ));

    return true; // Intercepted
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!isVoiceChannel(channel)) return;

    if (SelectedChannelStore.getVoiceChannelId() === channel.id) return;

    const isWaiting = waitingChannels.has(channel.id);
    const isFull = isChannelFull(channel);

    const items: any[] = [];
    if (isWaiting) {
        items.push(
            <Menu.MenuItem
                key="stop-waiting-slot"
                id="stop-waiting-slot"
                label="Stop Waiting for Slot"
                action={() => stopWaiting(channel.id)}
            />
        );
    } else if (isFull) {
        items.push(
            <Menu.MenuItem
                key="wait-for-slot"
                id="wait-for-slot"
                label="Wait for Slot"
                action={() => {
                    waitingChannels.add(channel.id);
                    if (settings.store.showNotice) {
                        showNotice(
                            React.createElement(
                                "div",
                                { className: "vc-wfs-notice" },
                                React.createElement(
                                    "span",
                                    { className: "vc-wfs-notice-text" },
                                    `Waiting for slot in ${channel.name}...`
                                ),
                                React.createElement(
                                    "div",
                                    { className: "vc-wfs-notice-actions" },
                                    React.createElement(
                                        Button,
                                        {
                                            size: "small",
                                            variant: "secondary",
                                            onClick: () => {
                                                const guildId = channel.guild_id ?? "@me";
                                                NavigationRouter.transitionTo(`/channels/${guildId}/${channel.id}`);
                                            }
                                        },
                                        "Jump"
                                    )
                                )
                            ),
                            "Stop",
                            () => stopWaiting(channel.id)
                        );
                    }
                }}
            />
        );
    }

    if (items.length > 0) {
        children.splice(-1, 0, ...items);
    }
};

// --- Plugin Definition ---



const logger = new Logger(pluginInfo.name, pluginInfo.color);

export default definePlugin({
    name: "Wait For Slot",
    description: "Multi-channel wait-for-slot functionality with high customizability.",
    authors: [{ name: "Bluscream", id: 467777925790564352n }],
    settings,


    patches: [
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            replacement: {
                match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/,
                replace: "||$self.promptVoiceChannel($1)"
            }
        }
    ],

    promptVoiceChannel,

    stopCleanup: null as (() => void) | null,
    start() {
        waitingChannels.clear();
        this.stopCleanup = registerSharedContextMenu("blu-vc-waitforslot", {
            "channel-context": (children, props) => {
                if (props.channel) VoiceChannelContext(children, props);
            }
        });
    },
    stop() {
        waitingChannels.clear();
        this.stopCleanup?.();
    },

    flux: {
        VOICE_STATE_UPDATES: handleVoiceStateUpdates
    },

    commands: [
        {
            name: "waiting",
            description: "List channels you are currently waiting for.",
            inputType: ApplicationCommandInputType.BOT,
            execute: (args, ctx) => {
                if (waitingChannels.size === 0) {
                    sendBotMessage(ctx.channel.id, { content: "You are not waiting for any channels." });
                    return;
                }

                let msg = "**Waiting for Slots:**\n";
                waitingChannels.forEach(id => {
                    const ch = ChannelStore.getChannel(id);
                    const guild = GuildStore.getGuild(ch?.guild_id);
                    msg += `- **${guild?.name || "Unknown"}** / #${ch?.name || id}\n`;
                });
                sendBotMessage(ctx.channel.id, { content: msg });
            }
        },
        {
            name: "stopwaiting",
            description: "Stop waiting for all channels.",
            inputType: ApplicationCommandInputType.BOT,
            execute: (args, ctx) => {
                const count = waitingChannels.size;
                waitingChannels.clear();
                sendBotMessage(ctx.channel.id, { content: `Stopped waiting for ${count} channels.` });
            }
        }
    ]
});
