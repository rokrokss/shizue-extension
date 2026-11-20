import Animal from '@/components/Character/Animal';
import CharacterStanding from '@/components/Character/CharacterStanding';

interface CharacterPickToggleProps {
  index: number;
  dark?: boolean;
}

// The floating button's figure: the animals and the standing rabbit, each sized to fit the button.
export const characterCountChat = 17;

const CharacterPickToggle = ({ index, dark }: CharacterPickToggleProps) => {
  const characters = [
    <Animal key="1" name="bear" scale={1.79} marginLeft={'6px'} dark={dark} />,
    <Animal key="2" name="raccoon" scale={1.7} marginLeft={'6px'} dark={dark} />,
    <Animal key="3" name="puppy" scale={1.7} marginLeft={'6px'} dark={dark} />,
    <Animal key="4" name="cat" scale={1.62} marginLeft={'6px'} dark={dark} />,
    <Animal key="5" name="frog" scale={2.2} marginLeft={'6px'} dark={dark} />,
    <Animal key="6" name="monkey" scale={2.0} marginLeft={'6px'} dark={dark} />,
    <Animal key="7" name="hamster" scale={2.0} marginLeft={'6px'} dark={dark} />,
    <Animal key="8" name="squirrel" scale={1.88} marginLeft={'6px'} dark={dark} />,
    <Animal key="9" name="penguin" scale={2.2} marginLeft={'6px'} dark={dark} />,
    <Animal key="10" name="panda" scale={1.88} marginLeft={'6px'} dark={dark} />,
    <Animal key="11" name="fox" scale={1.55} marginLeft={'6px'} dark={dark} />,
    <Animal key="12" name="hedgehog" scale={2.14} marginLeft={'6px'} dark={dark} />,
    <Animal key="13" name="duck" scale={2.0} marginLeft={'6px'} dark={dark} />,
    <Animal key="14" name="pig" scale={1.7} marginLeft={'6px'} dark={dark} />,
    <Animal key="15" name="sheep" scale={1.62} marginLeft={'6px'} dark={dark} />,
    <Animal key="16" name="owl" scale={2.0} marginLeft={'6px'} dark={dark} />,
    <CharacterStanding key="17" scale={1.9} marginLeft={'6px'} dark={dark} />,
  ];

  return characters[index % characters.length];
};

export default CharacterPickToggle;
