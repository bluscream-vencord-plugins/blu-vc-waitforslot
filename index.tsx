// Authors: Bluscream, Cursor.AI
// Created at 2025-10-05 18:00:43
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    Menu,
    React,
    VoiceStateStore,
    showToast,
    Toasts,
    Button,
    Text,
    SelectedChannelStore,
    GuildStore,
    ChannelStore,
} from "@webpack/common";
import {
    ModalRoot,
    ModalHeader,
    ModalContent,
    ModalFooter,
    ModalCloseButton,
    openModal,
    ModalProps,
    ModalSize,
} from "@utils/modal";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { CommandArgument, CommandContext } from "@vencord/discord-types";

interface VoiceStateChangeEvent {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfVideo: boolean;
    selfStream: boolean;
}

const { selectVoiceChannel } = findByPropsLazy(
    "selectVoiceChannel",
    "selectChannel"
);

// Global variables to track waiting channels
let waitingChannels: Set<Channel> = new Set();
let waitingToastInterval: NodeJS.Timeout | null = null;

interface VoiceChannelContextProps {
    channel: Channel;
}

interface WaitForSlotModalProps {
    modalProps: ModalProps;
    channel: Channel;
    onConfirm: () => void;
}

function WaitForSlotModal({
    modalProps,
    channel,
    onConfirm,
}: WaitForSlotModalProps) {
    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">Join Voice Channel</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Text variant="text-md/normal">
                    A slot is now available in <strong>{channel.name}</strong>.
                    Do you want to join?
                    {channel.userLimit && (
                        <>
                            <br />
                            <br />
                            This channel has a limit of {channel.userLimit}{" "}
                            users.
                        </>
                    )}
                </Text>
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={modalProps.onClose}
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.LINK}
                >
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        onConfirm();
                        modalProps.onClose();
                    }}
                    color={Button.Colors.BRAND}
                >
                    Join Channel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function getVoiceChannelUserCount(channelId: string): number {
    try {
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
        return voiceStates ? Object.keys(voiceStates).length : 0;
    } catch (error) {
        console.warn("Error getting voice channel user count:", error);
        return 0;
    }
}

function isChannelFull(channel: Channel): boolean {
    if (!channel || !channel.userLimit) return false;
    const currentUsers = getVoiceChannelUserCount(channel.id);
    return currentUsers >= channel.userLimit;
}

function playNotificationSound() {
    try {
        // Create a simple notification sound using Web Audio API
        const audioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(
            1000,
            audioContext.currentTime + 0.1
        );
        oscillator.frequency.setValueAtTime(
            800,
            audioContext.currentTime + 0.2
        );

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
            0.01,
            audioContext.currentTime + 0.3
        );

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
        console.warn("Could not play notification sound:", error);
    }
}

function getWaitingChannelsByGuild(): Map<string, string[]> {
    const channelsByGuild = new Map<string, string[]>();

    for (const channel of waitingChannels) {
        const guildId = channel.guild_id;
        if (!channelsByGuild.has(guildId)) {
            channelsByGuild.set(guildId, []);
        }
        channelsByGuild.get(guildId)!.push(channel.name);
    }

    return channelsByGuild;
}

function formatWaitingToast(): string {
    const channelCount = waitingChannels.size;
    const channelsByGuild = getWaitingChannelsByGuild();
    const serverCount = channelsByGuild.size;

    return `Waiting for slot in ${channelCount} channel${
        channelCount === 1 ? "" : "s"
    } in ${serverCount} server${serverCount === 1 ? "" : "s"}...`;
}

function findAssociatedTextChannel(voiceChannelId: string): string | null {
    const voiceChannel = ChannelStore.getChannel(voiceChannelId);
    if (!voiceChannel || !voiceChannel.guild_id) return null;

    // In Discord, voice channels often have the same ID as their associated text channel
    // Try using the voice channel ID directly as the text channel ID
    const textChannel = ChannelStore.getChannel(voiceChannelId);
    if (textChannel && textChannel.type === 0) {
        // Type 0 is GUILD_TEXT
        return voiceChannelId;
    }

    return null;
}

function addChannelToWaiting(channel: Channel) {
    waitingChannels.add(channel);
    updateWaitingToast();

    // Send local message
    const targetTextChannelId = findAssociatedTextChannel(channel.id);
    if (targetTextChannelId) {
        sendBotMessage(targetTextChannelId, {
            content: `Started waiting for a free slot in <#${channel.id}>`,
        });
    }
}

function removeChannelFromWaiting(
    channel: Channel,
    sendMessage: boolean = true
) {
    waitingChannels.delete(channel);

    // Send local message
    if (sendMessage) {
        const targetTextChannelId = findAssociatedTextChannel(channel.id);
        if (targetTextChannelId) {
            sendBotMessage(targetTextChannelId, {
                content: `Stopped waiting for a free slot in <#${channel.id}>`,
            });
        }
    }

    if (waitingChannels.size === 0) {
        stopWaiting();
    } else {
        updateWaitingToast();
    }
}

function stopWaiting() {
    waitingChannels.clear();
    stopWaitingToastInterval();
    showToast("Stopped waiting for voice channel slots", Toasts.Type.MESSAGE);
}

function startWaitingToastInterval() {
    // Clear any existing interval
    if (waitingToastInterval) {
        clearInterval(waitingToastInterval);
    }

    // Only start if setting is enabled and > 0
    if (!settings.store.toastInterval || settings.store.toastInterval <= 0)
        return;

    // Show initial toast
    showToast(formatWaitingToast(), Toasts.Type.MESSAGE);

    // Set up interval to show toast at user-defined interval
    waitingToastInterval = setInterval(() => {
        if (waitingChannels.size > 0) {
            showToast(formatWaitingToast(), Toasts.Type.MESSAGE);
        } else {
            // Stop interval if no channels are waiting
            stopWaitingToastInterval();
        }
    }, settings.store.toastInterval * 1000); // Convert seconds to milliseconds
}

function stopWaitingToastInterval() {
    if (waitingToastInterval) {
        clearInterval(waitingToastInterval);
        waitingToastInterval = null;
    }
}

function updateWaitingToast() {
    if (waitingChannels.size > 0) {
        // Start the interval if not already running
        if (!waitingToastInterval) {
            startWaitingToastInterval();
        }
    } else {
        // Stop the interval if no channels are waiting
        stopWaitingToastInterval();
    }
}

function joinAvailableChannel(channel: Channel) {
    // Clear all waiting channels
    waitingChannels.clear();
    stopWaitingToastInterval();

    // Play notification sound if enabled
    if (settings.store.playSound) {
        playNotificationSound();
    }

    // Show confirmation modal if setting is enabled, otherwise join immediately
    if (settings.store.showConfirmation) {
        showToast("Slot available! Confirming join...", Toasts.Type.SUCCESS);
        openModal((modalProps) => (
            <WaitForSlotModal
                modalProps={modalProps}
                channel={channel}
                onConfirm={() => {
                    console.log(
                        "Join Channel clicked, attempting to join:",
                        channel.id
                    );
                    try {
                        selectVoiceChannel(channel.id);
                        console.log("selectVoiceChannel called successfully");
                    } catch (error) {
                        console.error(
                            "Error calling selectVoiceChannel:",
                            error
                        );
                        showToast(
                            "Failed to join voice channel",
                            Toasts.Type.FAILURE
                        );
                    }
                }}
            />
        ));
    } else {
        showToast(
            "Slot available! Joining " + channel.name,
            Toasts.Type.SUCCESS
        );
        try {
            selectVoiceChannel(channel.id);
        } catch (error) {
            console.error("Error calling selectVoiceChannel:", error);
            showToast("Failed to join voice channel", Toasts.Type.FAILURE);
        }
    }
}

function handleVoiceStateUpdate(voiceStates: VoiceStateChangeEvent[]) {
    if (waitingChannels.size === 0) return;

    for (const voiceState of voiceStates) {
        // Check if someone left one of our waiting channels
        if (voiceState.oldChannelId) {
            const waitingChannel = Array.from(waitingChannels).find(
                (channel) => channel.id === voiceState.oldChannelId
            );

            if (waitingChannel && !isChannelFull(waitingChannel)) {
                // Found an available slot!
                joinAvailableChannel(waitingChannel);
                return; // Only join the first available channel
            }
        }
    }
}

function waitForSlot(channel: Channel) {
    // Add channel to waiting list
    addChannelToWaiting(channel);

    // Check immediately in case the channel is already available
    if (!isChannelFull(channel)) {
        joinAvailableChannel(channel);
    }
}

const VoiceChannelContext: NavContextMenuPatchCallback = (
    children,
    { channel }: VoiceChannelContextProps
) => {
    // Only for voice channels (type 2)
    if (!channel || channel.type !== 2) return;

    // Don't show if user is currently in this channel
    const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    if (currentVoiceChannelId === channel.id) return;

    const isWaitingForChannel = waitingChannels.has(channel);
    const currentUsers = getVoiceChannelUserCount(channel.id);
    const isFull = isChannelFull(channel);

    // Show "Stop waiting for slot" if currently waiting for this channel
    if (isWaitingForChannel) {
        const handleStopWaiting = () => {
            removeChannelFromWaiting(channel);
        };

        children.splice(
            -1,
            0,
            <Menu.MenuItem
                key="stop-waiting-for-slot"
                id="stop-waiting-for-slot"
                label="Stop waiting for slot"
                action={handleStopWaiting}
            />
        );
        return;
    }

    // Don't show "Wait for Slot" if channel is empty or not full
    if (currentUsers === 0 || !isFull) return;

    const handleWaitForSlot = () => {
        waitForSlot(channel);
    };

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            key="wait-for-slot"
            id="wait-for-slot"
            label="Wait for slot"
            action={handleWaitForSlot}
        />
    );
};

const settings = definePluginSettings({
    showConfirmation: {
        type: OptionType.BOOLEAN,
        description: "Show confirmation modal when a slot becomes available",
        default: true,
        restartNeeded: false,
    },
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play notification sound when a slot becomes available",
        default: true,
        restartNeeded: false,
    },
    stopOnDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Stop waiting when you disconnect from voice",
        default: true,
        restartNeeded: false,
    },
    toastInterval: {
        type: OptionType.SLIDER,
        description:
            "Interval between waiting status toasts (seconds, 0 = off)",
        markers: [0, 10, 20, 30, 60, 120, 300],
        stickToMarkers: false,
        default: 30,
        restartNeeded: false,
    },
});

export default definePlugin({
    name: "WaitForSlot",
    description:
        "Adds a 'Wait for Slot' button to voice channel context menus that waits until a slot becomes available. Supports multiple channels across multiple servers.",
    authors: [
        { name: "Bluscream", id: 467777925790564352n },
        { name: "Cursor.AI", id: 0n },
    ],

    settings,

    contextMenus: {
        "channel-context": VoiceChannelContext,
    },

    commands: [
        {
            name: "stopwaiting",
            description: "Stop waiting for voice channel slots",
            inputType: ApplicationCommandInputType.BOT,
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                if (waitingChannels.size > 0) {
                    stopWaiting();
                    sendBotMessage(ctx.channel.id, {
                        content: "Stopped waiting for voice channel slots",
                    });
                } else {
                    sendBotMessage(ctx.channel.id, {
                        content:
                            "Not currently waiting for any voice channel slots",
                    });
                }
            },
        },
        {
            name: "waiting",
            description: "List all voice channels you're currently waiting for",
            inputType: ApplicationCommandInputType.BOT,
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                if (waitingChannels.size === 0) {
                    sendBotMessage(ctx.channel.id, {
                        content:
                            "Not currently waiting for any voice channel slots",
                    });
                    return;
                }

                // Group channels by guild
                const channelsByGuild = new Map<string, Channel[]>();
                for (const channel of waitingChannels) {
                    const guildId = channel.guild_id;
                    if (!channelsByGuild.has(guildId)) {
                        channelsByGuild.set(guildId, []);
                    }
                    channelsByGuild.get(guildId)!.push(channel);
                }

                // Build the response message with slot and server counts
                const totalChannels = waitingChannels.size;
                const totalServers = channelsByGuild.size;
                const parts: string[] = [];
                parts.push(
                    `**Currently waiting for slots in:**\n` +
                        `> **${totalChannels} channel${
                            totalChannels === 1 ? "" : "s"
                        }** in **${totalServers} server${
                            totalServers === 1 ? "" : "s"
                        }**\n`
                );
                for (const [guildId, channels] of channelsByGuild) {
                    const guild = GuildStore.getGuild(guildId);
                    const guildName = guild?.name || "Unknown Server";
                    parts.push(`**\`${guildName}\`**`);

                    for (const channel of channels) {
                        const currentUsers = getVoiceChannelUserCount(
                            channel.id
                        );
                        const userLimit = channel.userLimit || "∞";
                        parts.push(
                            `• <#${channel.id}> \`${currentUsers}/${userLimit} users\``
                        );
                    }
                    parts.push(""); // Empty line between guilds
                }

                const message = parts.join("\n").trim();
                sendBotMessage(ctx.channel.id, {
                    content: message,
                });
            },
        },
    ],

    start() {
        // Plugin initialized
    },

    flux: {
        VOICE_STATE_UPDATES({
            voiceStates,
        }: {
            voiceStates: VoiceStateChangeEvent[];
        }) {
            handleVoiceStateUpdate(voiceStates);

            // Implement stopOnDisconnect
            if (settings.store.stopOnDisconnect) {
                const currentVoiceChannelId =
                    SelectedChannelStore.getVoiceChannelId();
                // If user disconnects from voice (no current channel) and we're waiting, stop waiting
                if (!currentVoiceChannelId && waitingChannels.size > 0) {
                    stopWaiting();
                }
            }
        },
        CHANNEL_DELETE({ channel }: { channel: Channel }) {
            // Check if the deleted channel is one we're waiting for
            const waitingChannel = Array.from(waitingChannels).find(
                (ch) => ch.id === channel.id
            );

            if (waitingChannel) {
                // Remove from waiting list without sending a message (channel no longer exists)
                removeChannelFromWaiting(waitingChannel, false);

                // Show toast notification
                showToast(
                    `Channel ${waitingChannel.name} was deleted and removed from waiting list`,
                    Toasts.Type.MESSAGE
                );
            }
        },
    },

    stop() {
        // Clean up
        stopWaiting();
    },
});
