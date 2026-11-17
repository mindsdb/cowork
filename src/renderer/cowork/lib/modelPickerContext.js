import { createContext, useContext } from 'react';

// The composer's model catalog for surfaces that show a model picker away
// from the composer, such as the artifact viewer's chat bar (ENG-4227).
// App owns `{ models, modelMeta }`, the same list and metadata it hands the
// composer, and provides them here instead of threading props through every
// view that mounts a viewer. Default null: no catalog, no picker.
export const ModelPickerContext = createContext(null);

export function useModelPickerContext() {
  return useContext(ModelPickerContext);
}
