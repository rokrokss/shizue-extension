import bear from '@/assets/character/bear.png';
import cat from '@/assets/character/cat.png';
import duck from '@/assets/character/duck.png';
import duckDark from '@/assets/character/duck_dark.png';
import fox from '@/assets/character/fox.png';
import frog from '@/assets/character/frog.png';
import hamster from '@/assets/character/hamster.png';
import hamsterDark from '@/assets/character/hamster_dark.png';
import hedgehog from '@/assets/character/hedgehog.png';
import monkey from '@/assets/character/monkey.png';
import owl from '@/assets/character/owl.png';
import panda from '@/assets/character/panda.png';
import pandaDark from '@/assets/character/panda_dark.png';
import penguin from '@/assets/character/penguin.png';
import penguinDark from '@/assets/character/penguin_dark.png';
import pig from '@/assets/character/pig.png';
import puppy from '@/assets/character/puppy.png';
import raccoon from '@/assets/character/raccoon.png';
import raccoonDark from '@/assets/character/raccoon_dark.png';
import sheep from '@/assets/character/sheep.png';
import squirrel from '@/assets/character/squirrel.png';
import squirrelDark from '@/assets/character/squirrel_dark.png';
import { useEffect, useState } from 'react';

// The animals drawn for the Shizue app square by square, each doing something of its day, as the
// app has them (its tools/animal_figures.py writes the strips): frames side by side with no gap.
// An animal with white in it has a sheet for dark mode with that white cream, as the rabbit has:
// the invert filter turns a white body black.
export const ANIMALS = {
  bear: { image: bear, width: 19, height: 15, frames: 8, every: 170 },
  raccoon: { image: raccoon, dark: raccoonDark, width: 20, height: 13, frames: 8, every: 130 },
  puppy: { image: puppy, width: 20, height: 15, frames: 8, every: 110 },
  cat: { image: cat, width: 21, height: 13, frames: 8, every: 140 },
  frog: { image: frog, width: 13, height: 12, frames: 8, every: 130 },
  monkey: { image: monkey, width: 17, height: 15, frames: 8, every: 130 },
  hamster: { image: hamster, dark: hamsterDark, width: 17, height: 12, frames: 8, every: 150 },
  squirrel: { image: squirrel, dark: squirrelDark, width: 17, height: 16, frames: 8, every: 110 },
  penguin: { image: penguin, dark: penguinDark, width: 14, height: 13, frames: 7, every: 250 },
  panda: { image: panda, dark: pandaDark, width: 17, height: 16, frames: 8, every: 140 },
  fox: { image: fox, width: 22, height: 16, frames: 10, every: 120 },
  hedgehog: { image: hedgehog, width: 14, height: 14, frames: 12, every: 130 },
  duck: { image: duck, dark: duckDark, width: 16, height: 15, frames: 12, every: 150 },
  pig: { image: pig, width: 20, height: 16, frames: 8, every: 170 },
  sheep: { image: sheep, width: 21, height: 15, frames: 8, every: 170 },
  owl: { image: owl, width: 17, height: 15, frames: 12, every: 160 },
};

export type AnimalName = keyof typeof ANIMALS;

interface Sheet {
  image: string;
  dark?: string;
  width: number;
  height: number;
  frames: number;
  every: number;
}

const Animal = ({
  name,
  scale,
  marginLeft,
  dark,
}: {
  name: AnimalName;
  scale: number;
  marginLeft: string;
  dark?: boolean;
}) => {
  const [frame, setFrame] = useState(0);
  const animal: Sheet = ANIMALS[name];

  const x = -animal.width * frame;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % animal.frames);
    }, animal.every);
    return () => {
      clearInterval(interval);
    };
  }, [animal]);

  return (
    <div
      className="sz:mr-[0px] sz:mb-[0px] sz:mt-[0px]"
      style={{
        width: `${animal.width * scale}px`,
        height: `${animal.height * scale}px`,
        backgroundImage: `url(${dark && animal.dark ? animal.dark : animal.image})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `${x * scale}px 0px`,
        backgroundSize: `auto ${animal.height * scale}px`,
        imageRendering: 'pixelated',
        marginLeft: marginLeft,
      }}
    />
  );
};

export default Animal;
