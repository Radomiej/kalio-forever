import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonaCombobox } from './PersonaCombobox';

const OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'qa', label: 'Quality Analyst' },
  { id: 'writer', label: 'Technical Writer' },
];

describe('PersonaCombobox', () => {
  it('filters personas and selects the highlighted result from the keyboard', () => {
    const onChange = vi.fn();
    render(
      <PersonaCombobox
        id="persona"
        options={OPTIONS}
        value="default"
        onChange={onChange}
        testId="persona-combobox"
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Persona' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search personas' }), {
      target: { value: 'quality' },
    });

    expect(screen.getByRole('option', { name: 'Quality Analyst' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Technical Writer' })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search personas' }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search personas' }), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('qa');
    expect(screen.getByRole('combobox', { name: 'Persona' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the result list with Escape without changing the value', () => {
    const onChange = vi.fn();
    render(
      <PersonaCombobox
        id="persona"
        options={OPTIONS}
        value="default"
        onChange={onChange}
        testId="persona-combobox"
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Persona' }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search personas' }), { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
