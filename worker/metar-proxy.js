export default {
  async fetch(request) {
    const url = new URL(request.url);
    const ids = url.searchParams.get('ids');

    if (!ids || !/^[A-Z0-9]{4}$/.test(ids)) {
      return new Response('Bad station code', { status: 400 });
    }

    const upstream = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=raw`;
    const resp = await fetch(upstream, {
      headers: { 'User-Agent': 'BWHS-METAR-Tutorial/1.0' },
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    });
  },
};
