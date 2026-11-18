import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import valueSets from './fixtures/value-sets.json';

// Every field's value set, exported from the migrations
// (pnpm fixtures:value-sets). Served by default so screens show real labels
// and offer real options; a test that needs other values overrides the
// route with server.use().

const defaultHandlers = [
  http.get('*/api/v1/fields/:entity/:field/value-set', ({ params, request }) => {
    const set = valueSets[`${String(params['entity'])}/${String(params['field'])}`];
    if (!set) {
      return HttpResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
    }
    const all = new URL(request.url).searchParams.get('include') === 'all';
    return HttpResponse.json({ ...set, members: all ? set.members : set.members.filter((m) => m.selectable) });
  }),
];

export const server = setupServer(...defaultHandlers);
