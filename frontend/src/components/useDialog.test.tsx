import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDialog } from './useDialog';

/**
 * The keyboard contract for every overlay in the app (PLAN.md §11, 8.3).
 *
 * These are assertions about *focus*, which is the one part of an interface
 * that a screenshot cannot show and a human tester reliably forgets to check.
 * All three failures below were live in eight overlays before this hook.
 */

function Panel({ onClose }: { readonly onClose: () => void }) {
  const dialog = useDialog('Test dialog', onClose);
  return (
    <div {...dialog}>
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <button type="button">behind</button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  );
}

describe('useDialog', () => {
  it('announces itself as a modal dialog with a name', () => {
    render(<Panel onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');

    // `aria-modal` is what marks everything behind it inert. Without it a
    // screen reader reads the workspace the user cannot reach.
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Test dialog');
  });

  it('moves focus into itself when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('opener'));

    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('wraps forward from the last control instead of leaving the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('opener'));

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText('last'));

    // The failure this prevents: focus lands on "behind", which is covered by
    // the backdrop and unreachable by mouse — the user is now typing into
    // something they cannot see.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('wraps backward from the first control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('opener'));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('gives focus back to whatever opened it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByText('opener');
    await user.click(opener);
    expect(document.activeElement).not.toBe(opener);

    await user.keyboard('{Escape}');

    // Without this, focus falls to <body> and the next Tab starts from the top
    // of the window rather than from the button just pressed.
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('opener'));
    expect(screen.queryByRole('dialog')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus on the panel when it holds nothing focusable', async () => {
    // A dialog can be a message with no controls but its close affordance in
    // the header; Tab must still not escape to the page behind it.
    function Empty() {
      const dialog = useDialog('Empty', () => undefined);
      return (
        <div {...dialog}>
          <p>nothing to focus</p>
        </div>
      );
    }
    const user = userEvent.setup();
    render(
      <>
        <button type="button">behind</button>
        <Empty />
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});
