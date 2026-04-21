import axios from 'axios';

const apiUrl = import.meta.env['VITE_API_URL'] as string ?? 'http://localhost:3016';

export const apiClient = axios.create({
  baseURL: apiUrl,
  headers: { 'Content-Type': 'application/json' },
});
