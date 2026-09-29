import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app header', () => {
  render(<App />);
  const headerElement = screen.getByText(/Emotionally Aware Memory Agent/i);
  expect(headerElement).toBeInTheDocument();
});
