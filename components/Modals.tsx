import { Button, TextButton } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import {
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalProps,
    ModalRoot,
    ModalSize,
} from "@utils/modal";
import { BaseText } from "@components/BaseText";
import { Channel } from "@vencord/discord-types";

interface WaitForSlotModalProps {
    modalProps: ModalProps;
    channel: Channel;
    onConfirm: () => void;
}

export function WaitForSlotModal({ modalProps, channel, onConfirm }: WaitForSlotModalProps) {
    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <BaseText size="lg" weight="semibold">Slot Available!</BaseText>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Paragraph size="md">
                    A slot is now available in <strong>{channel.name}</strong>.
                    Do you want to join?
                </Paragraph>
            </ModalContent>
            <ModalFooter>
                <TextButton onClick={modalProps.onClose}>Cancel</TextButton>
                <Button
                    onClick={() => {
                        onConfirm();
                        modalProps.onClose();
                    }}
                    variant="primary"
                >
                    Join Channel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

interface FullChannelModalProps {
    modalProps: ModalProps;
    channel: Channel;
    onWait: () => void;
}

export function FullChannelModal({ modalProps, channel, onWait }: FullChannelModalProps) {
    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <BaseText size="lg" weight="semibold">Channel is Full</BaseText>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Paragraph size="md">
                    <strong>{channel.name}</strong> is currently full ({channel.userLimit}/{channel.userLimit}).
                    Would you like to wait for a slot to open?
                </Paragraph>
            </ModalContent>
            <ModalFooter>
                <TextButton onClick={modalProps.onClose}>Cancel</TextButton>
                <Button
                    onClick={() => {
                        onWait();
                        modalProps.onClose();
                    }}
                    variant="primary"
                >
                    Wait for Slot
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}
