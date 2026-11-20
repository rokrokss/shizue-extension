import Animal from '@/components/Character/Animal';
import CharacterForward from '@/components/Character/CharacterForward';
import CharacterStanding from '@/components/Character/CharacterStanding';

interface CharacterPickChatProps {
  index: number;
  scale: number;
  marginLeft: string;
  dark?: boolean;
}

// The figures a message is drawn beside, in the Shizue app's order (the walking rabbit, the
// animals, the standing rabbit), so that a message has the same figure in both.
export const characterCount = 18;

const CharacterPickChat = ({ index, scale, marginLeft, dark }: CharacterPickChatProps) => {
  const characters = [
    <CharacterForward key="0" scale={2 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="1" name="bear" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="2" name="raccoon" scale={2.46 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="3" name="puppy" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="4" name="cat" scale={2.46 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="5" name="frog" scale={2.5 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="6" name="monkey" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="7" name="hamster" scale={2.5 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="8" name="squirrel" scale={2.0 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="9" name="penguin" scale={2.46 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="10" name="panda" scale={2.0 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="11" name="fox" scale={2.0 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="12" name="hedgehog" scale={2.29 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="13" name="duck" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="14" name="pig" scale={2.0 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="15" name="sheep" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <Animal key="16" name="owl" scale={2.13 * scale} marginLeft={marginLeft} dark={dark} />,
    <CharacterStanding key="17" scale={2 * scale} marginLeft={marginLeft} dark={dark} />,
  ];

  return <div>{characters[index % characters.length]}</div>;
};

export default CharacterPickChat;
