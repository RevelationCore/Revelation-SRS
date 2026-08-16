import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AddAddressPage } from '../src/pages/AddAddressPage.js';

const API = 'http://localhost:3000';
const ADDRESS_ID = 'address-001';

const valueSet = { setCode: 'student_address.address_type_code', displayName: 'Address type', members: [{ code: 'term-time', displayLabel: 'Term-time', description: null, sortOrder: 1 }] };
const existingAddress = { id: ADDRESS_ID, addressTypeCode: 'term-time', line1: '1 Old Road', line2: null, city: 'Oldtown', postcode: 'OX1 1AA', countryCode: 'GB', validFrom: '2025-01-01' };

function routes() {
  return (
    <Routes>
      <Route path="/profile/addresses/new" element={<AddAddressPage />} />
      <Route path="/profile/addresses/:addressId/edit" element={<AddAddressPage />} />
      <Route path="/profile" element={<div>Profile page</div>} />
    </Routes>
  );
}

describe('student record update workflow — portal address edit', () => {
  it('initial load: pre-fills the form from the existing address once it resolves', async () => {
    server.use(
      http.get(`${API}/api/v1/fields/student_address/address_type_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students/:personId/addresses/:addressId`, () => HttpResponse.json(existingAddress)),
    );
    const { container } = renderWithProviders(routes(), { route: `/profile/addresses/${ADDRESS_ID}/edit` });
    expect(await screen.findByDisplayValue('1 Old Road')).toBeVisible();
    expect(screen.getByDisplayValue('OX1 1AA')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('valid edit: submitting a changed line1 persists it and returns to the profile with a visible confirmation', async () => {
    let requestBody: unknown;
    server.use(
      http.get(`${API}/api/v1/fields/student_address/address_type_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students/:personId/addresses/:addressId`, () => HttpResponse.json(existingAddress)),
      http.post(`${API}/api/v1/students/:personId/addresses`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ addressId: ADDRESS_ID }, { status: 201 });
      }),
    );
    renderWithProviders(routes(), { route: `/profile/addresses/${ADDRESS_ID}/edit` });
    await screen.findByDisplayValue('1 Old Road');

    const line1 = screen.getByLabelText(/Address line 1/);
    await userEvent.clear(line1);
    await userEvent.type(line1, '2 New Road');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update address' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Update address' }));

    expect(await screen.findByText('Profile page')).toBeVisible();
    expect(requestBody).toMatchObject({ line1: '2 New Road', addressTypeCode: 'term-time' });
  });

  it('conflict: a 409 from the server surfaces as a submit error and keeps the entered data on screen', async () => {
    server.use(
      http.get(`${API}/api/v1/fields/student_address/address_type_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students/:personId/addresses/:addressId`, () => HttpResponse.json(existingAddress)),
      http.post(`${API}/api/v1/students/:personId/addresses`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', detail: 'This address was updated by someone else. Reload and try again.' }, { status: 409 })),
    );
    renderWithProviders(routes(), { route: `/profile/addresses/${ADDRESS_ID}/edit` });
    await screen.findByDisplayValue('1 Old Road');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update address' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Update address' }));

    expect(await screen.findByText('This address was updated by someone else. Reload and try again.')).toBeVisible();
    expect(screen.getByDisplayValue('1 Old Road')).toBeVisible();
  });

  it('forbidden: a 403 loading the existing address shows an accessible problem instead of a broken form', async () => {
    server.use(
      http.get(`${API}/api/v1/fields/student_address/address_type_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students/:personId/addresses/:addressId`, () => HttpResponse.json({ type: 'about:blank', title: 'Forbidden', detail: 'You do not have access to this address.' }, { status: 403 })),
    );
    renderWithProviders(routes(), { route: `/profile/addresses/${ADDRESS_ID}/edit` });
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this address.');
  });

  it(`personId does not leak into the request body`, async () => {
    // Guard against a common regression: personId is a path param, not a body field.
    let requestBody: Record<string, unknown> = {};
    server.use(
      http.get(`${API}/api/v1/fields/student_address/address_type_code/value-set`, () => HttpResponse.json(valueSet)),
      http.post(`${API}/api/v1/students/:personId/addresses`, async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ addressId: 'address-002' }, { status: 201 });
      }),
    );
    renderWithProviders(routes(), { route: '/profile/addresses/new' });
    await screen.findByLabelText(/Address type/);
    await userEvent.selectOptions(screen.getByLabelText(/Address type/), 'term-time');
    await userEvent.type(screen.getByLabelText(/Address line 1/), '3 Test Street');
    await userEvent.click(screen.getByRole('button', { name: 'Add address' }));

    expect(await screen.findByText('Profile page')).toBeVisible();
    expect(requestBody).not.toHaveProperty('personId');
    expect(requestBody).toMatchObject({ line1: '3 Test Street' });
  });
});
