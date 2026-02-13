import { sendBotMessage } from "@api/Commands";
import { popNotice, showNotice } from "@api/Notices";
import { openModal, ModalProps } from "@utils/modal";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, SelectedChannelStore, ChannelActions } from "@webpack/common";
import { Button } from "@components/Button";
import { playAudio } from "@api/AudioPlayer";
import { React } from "@webpack/common";

import { settings } from "./settings";
import { findAssociatedTextChannel, isChannelFull } from "./utils";
import { WaitForSlotModal } from "./components/Modals";
import { waitingChannels, lastKnownVoiceChannelId, setLastKnownVoiceChannelId, joinChannel } from "./state";

interface VoiceStateChangeEvent {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

export function onSlotAvailable(channel: Channel) {
    // 0. Play sound regardless of confirmation method if enabled
    if (settings.store.notificationSound) {
        playAudio(settings.store.notificationSoundUrl);
    }

    // 1. Auto Join
    if (settings.store.autoJoin) {
        joinChannel(channel.id);
        return; // Auto-join skips other notifications
    }

    // 2. Notifications (Concurrent)

    // Banner Notice
    if (settings.store.showNotice) {
        showNotice(
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>Slot available in <strong>{channel.name}</strong>!</span>
                <Button
                    size="small"
                    onClick={() => {
                        ChannelActions.selectChannel(channel.id);
                        popNotice();
                    }}
                >
                    Focus
                </Button>
            </div>,
            "Join",
            () => {
                popNotice();
                joinChannel(channel.id);
            }
        );
    }

    // Modal
    if (settings.store.showModal) {
        openModal((modalProps: ModalProps) => (
            <WaitForSlotModal
                modalProps={modalProps}
                channel={channel}
                onConfirm={() => joinChannel(channel.id)}
            />
        ));
    }

    // Bot Message
    if (settings.store.sendBotMessage) {
        const textChannelId = findAssociatedTextChannel(channel.id);
        if (textChannelId) {
            sendBotMessage(textChannelId, {
                content: `Found a slot in <#${channel.id}>!`,
            });
        }
    }
}

export function handleVoiceStateUpdates({ voiceStates }: { voiceStates: VoiceStateChangeEvent[] }) {
    if (waitingChannels.size === 0) return;

    if (settings.store.stopOnDisconnect) {
        const currentId = SelectedChannelStore.getVoiceChannelId();
        if (lastKnownVoiceChannelId && !currentId) {
            waitingChannels.clear();
            setLastKnownVoiceChannelId(null);
            return;
        }
        setLastKnownVoiceChannelId(currentId ?? null);
    }

    for (const channelId of waitingChannels) {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel || !isChannelFull(channel)) {
            // ChannelStore.getChannel might return undefined, provide a fallback partial object if needed for the ID
            // but ideally we only proceed if we have a valid channel object or at least the name.
            const channelObj = channel || { id: channelId, name: "Unknown" } as Channel;
            onSlotAvailable(channelObj);
            break;
        }
    }
}
