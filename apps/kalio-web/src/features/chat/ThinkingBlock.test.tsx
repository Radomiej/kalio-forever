import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ThinkingBlock } from './ThinkingBlock';

it('exposes disclosure state and remains manually collapsible while thinking', () => {
  const { rerender } = render(<ThinkingBlock content="Working" isStreaming />);
  const button = screen.getByRole('button', { name: 'Thinking' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  const contentId = button.getAttribute('aria-controls');
  expect(contentId).toBeTruthy();
  expect(document.getElementById(contentId!)).toHaveTextContent('Working');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  rerender(<ThinkingBlock content="Working further" isStreaming />);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  rerender(<ThinkingBlock content="Working further" isStreaming={false} />);
  expect(button.querySelector('.loading, .animate-pulse')).toBeNull();
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(contentId!)).toHaveTextContent('Working further');
});
