/* A generated image's inline card (ENG-4024): a picture that fails to decode
   says so, and a new file in the same card gets a fresh try. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The bytes "arrive" at once, as a blob: URL named after the file's url.
vi.mock('./AttachmentThumbnail', () => ({
  useBlobImageSrc: ({ url }) => ({ src: url ? `blob:${url}` : '', failed: !url }),
}));

import GeneratedImageCard from './GeneratedImageCard';

const image = (path) => ({ path, name: path.split('/').pop(), width: 512, height: 512, prompt: `A picture at ${path}` });
const card = (path) => <GeneratedImageCard image={image(path)} projectName="acme" projectPath="/tmp/acme" />;

describe('GeneratedImageCard', () => {
  it('says a picture that does not decode could not be shown', () => {
    render(card('images/cat.png'));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText(/could not be shown/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('tries again when the card is handed a different file', () => {
    const view = render(card('images/cat.png'));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText(/could not be shown/)).toBeInTheDocument();

    view.rerender(card('images/dog.png'));
    expect(screen.queryByText(/could not be shown/)).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'A picture at images/dog.png');
  });
});
