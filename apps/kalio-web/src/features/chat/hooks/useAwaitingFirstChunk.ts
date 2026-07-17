import { useRef, useState } from 'react';

export function createIdempotentBooleanSetter(
  apply: (value: boolean) => void,
  initialValue = false,
): (value: boolean) => void {
  let currentValue = initialValue;
  return (nextValue) => {
    if (nextValue === currentValue) {
      return;
    }
    currentValue = nextValue;
    apply(nextValue);
  };
}

export function useAwaitingFirstChunk(): readonly [boolean, (value: boolean) => void] {
  const [awaitingFirstChunk, setAwaitingFirstChunkState] = useState(false);
  const setterRef = useRef<((value: boolean) => void) | null>(null);

  const setAwaitingFirstChunk = setterRef.current
    ?? createIdempotentBooleanSetter(setAwaitingFirstChunkState);
  setterRef.current = setAwaitingFirstChunk;

  return [awaitingFirstChunk, setAwaitingFirstChunk];
}
