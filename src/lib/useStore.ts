import { useState, useEffect } from 'react';
import { store } from './store';

export function useStore() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setTick((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  return store;
}
