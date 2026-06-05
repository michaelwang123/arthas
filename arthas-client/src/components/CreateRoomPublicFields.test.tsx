/**
 * CreateRoomPublicFields component tests.
 *
 * Tests: toggle behavior, title/description inputs, tag add/remove/validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateRoomPublicFields, type PublicFieldsData } from './CreateRoomPublicFields';

// Mock i18n to return key as translation
vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

function renderWithState(initial?: Partial<PublicFieldsData>) {
  const value: PublicFieldsData = {
    isPublic: false,
    title: '',
    description: '',
    tags: [],
    ...initial,
  };
  const onChange = vi.fn();
  const result = render(<CreateRoomPublicFields value={value} onChange={onChange} />);
  return { ...result, onChange, value };
}

describe('CreateRoomPublicFields', () => {
  it('renders toggle in off state by default', () => {
    renderWithState();
    const toggle = screen.getByLabelText(/hub\.public\.toggle/);
    expect(toggle).not.toBeChecked();
  });

  it('does not show fields when toggle is off', () => {
    renderWithState({ isPublic: false });
    expect(screen.queryByPlaceholderText(/hub\.public\.titlePlaceholder/)).not.toBeInTheDocument();
  });

  it('shows fields when toggle is on', () => {
    renderWithState({ isPublic: true });
    expect(screen.getByPlaceholderText(/hub\.public\.titlePlaceholder/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/hub\.public\.descPlaceholder/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/hub\.public\.tagPlaceholder/)).toBeInTheDocument();
  });

  it('calls onChange with isPublic=true when toggle is clicked', () => {
    const { onChange } = renderWithState();
    const toggle = screen.getByLabelText(/hub\.public\.toggle/);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }));
  });

  it('calls onChange with title when title input changes', () => {
    const { onChange } = renderWithState({ isPublic: true });
    const titleInput = screen.getByPlaceholderText(/hub\.public\.titlePlaceholder/);
    fireEvent.change(titleInput, { target: { value: 'My Room' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Room' }));
  });

  it('calls onChange with description when textarea changes', () => {
    const { onChange } = renderWithState({ isPublic: true });
    const descInput = screen.getByPlaceholderText(/hub\.public\.descPlaceholder/);
    fireEvent.change(descInput, { target: { value: 'A cool room' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'A cool room' }));
  });

  it('adds a tag when + button clicked with valid input', () => {
    const { onChange } = renderWithState({ isPublic: true });
    const tagInput = screen.getByPlaceholderText(/hub\.public\.tagPlaceholder/);
    const addButton = screen.getByText('+');

    fireEvent.change(tagInput, { target: { value: 'golang' } });
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['golang'] }));
  });

  it('adds a tag on Enter key', () => {
    const { onChange } = renderWithState({ isPublic: true });
    const tagInput = screen.getByPlaceholderText(/hub\.public\.tagPlaceholder/);

    fireEvent.change(tagInput, { target: { value: 'react' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['react'] }));
  });

  it('disables add button when at max 5 tags', () => {
    renderWithState({ isPublic: true, tags: ['a', 'b', 'c', 'd', 'e'] });
    const addButton = screen.getByText('+');
    expect(addButton).toBeDisabled();
  });

  it('shows error for invalid tag format', () => {
    renderWithState({ isPublic: true });
    const tagInput = screen.getByPlaceholderText(/hub\.public\.tagPlaceholder/);
    const addButton = screen.getByText('+');

    fireEvent.change(tagInput, { target: { value: 'no spaces!' } });
    fireEvent.click(addButton);

    expect(screen.getByText('hub.public.tagFormatError')).toBeInTheDocument();
  });

  it('removes a tag when × clicked', () => {
    const { onChange } = renderWithState({ isPublic: true, tags: ['golang', 'react'] });
    const removeButtons = screen.getAllByText('×');
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['react'] }));
  });

  it('converts tags to lowercase', () => {
    const { onChange } = renderWithState({ isPublic: true });
    const tagInput = screen.getByPlaceholderText(/hub\.public\.tagPlaceholder/);
    const addButton = screen.getByText('+');

    fireEvent.change(tagInput, { target: { value: 'GoLang' } });
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['golang'] }));
  });
});
