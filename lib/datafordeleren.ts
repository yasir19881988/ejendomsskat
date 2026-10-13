import axios, { AxiosInstance } from 'axios';

// ---------- Types: Tinglysning / Datafordeleren ----------

export interface TinglysningEjendom {
  id: string;
  bfeNummer: number;
  ejendomsnummer: number;
  kommunekode: string;
  ejendomstype: string;
  beloeb: number | null;
  valuta: string;
  overfoerselsdato: string | null;
  modtagerNavn: string | null;
  modtagerCvr: string | null;
}

export interface TinglysningSoegningResult {
  hits: TinglysningEjendom[];
  total: number;
}

// ---------- OAuth Token Management ----------

interface OAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number; // timestamp
}

let cachedToken: OAuthToken | null = null;

/**
 * Hent OAuth access token fra Datafordeleren.
 * Bruger OAuth 2.0 Client Credentials flow med Shared Secret.
 */
async function hentOAuthToken(): Promise<string> {
  const clientId = process.env.DATAFORDELER_CLIENT_ID;
  const clientSecret = process.env.DATAFORDELER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('DATAFORDELER_CLIENT_ID eller DATAFORDELER_CLIENT_SECRET er ikke sat i miljøvariabler');
  }

  // Returner cached token hvis det stadig er gyldigt
  if (cachedToken && cachedToken.expires_at > Date.now() + 60000) {
    return cachedToken.access_token;
  }

  const response = await axios.post<OAuthToken>(
    'https://auth.datafordeler.dk/realms/distribution/protocol/openid-connect/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  cachedToken = {
    ...response.data,
    expires_at: Date.now() + response.data.expires_in * 1000,
  };

  return cachedToken.access_token;
}

// ---------- Client ----------

const DATAFORDELER_BASE_URL = 'https://services.datafordeler.dk';

class DatafordelerenClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: DATAFORDELER_BASE_URL,
      timeout: 15000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * Hent tinglyst kontant købesum for en ejendom via BFE-nummer.
   * Endpoint: Tinglysning / AkmSkodePrEjendom
   *
   * Kræver OAuth Shared Secret (fortrolige data).
   * Miljøvariabler: DATAFORDELER_CLIENT_ID og DATAFORDELER_CLIENT_SECRET
   */
  async hentTinglystKoebesum(bfeNummer: string): Promise<TinglysningEjendom[]> {
    try {
      const token = await hentOAuthToken();

      const { data } = await this.http.get<TinglysningEjendom[]>(
        '/TINGLYSNING/Tinglysning/1/rest/AkmSkodePrEjendom',
        {
          params: {
            BFENummer: bfeNummer,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return data;
    } catch (error) {
      console.error('Fejl ved hentning af tinglyst købesum:', error);
      return [];
    }
  }

  /**
   * Søg solgte ejendomme i et postnummer inden for et areal-interval.
   * Bruges til nabotjek / reference-sammenligning.
   */
  async soegSolgteEjendomme(params: {
    postnr: string;
    minAreal?: number;
    maxAreal?: number;
    limit?: number;
  }): Promise<TinglysningSoegningResult> {
    try {
      const token = await hentOAuthToken();

      const { data } = await this.http.get<TinglysningSoegningResult>(
        '/TINGLYSNING/Tinglysning/1/rest/AkmSkodePrEjendom',
        {
          params: {
            Postnr: params.postnr,
            MinAreal: params.minAreal,
            MaxAreal: params.maxAreal,
            Periode: '2aar',
            per_side: params.limit ?? 50,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return data;
    } catch (error) {
      console.error('Fejl ved søgning af solgte ejendomme:', error);
      return { hits: [], total: 0 };
    }
  }
}

export const datafordelerenClient = new DatafordelerenClient();

// ---------- Hjælpefunktioner ----------

export interface SalgsReference {
  adresse: string;
  bfeNummer: string;
  koebesum: number;
  salgsdato: string;
  boligArealM2: number;
  m2Pris: number;
}

export interface Nabosammenligning {
  referencer: SalgsReference[];
  gennemsnitM2Pris: number;
  medianM2Pris: number;
  antalReferencer: number;
  sammenligningsPeriode: string;
}

/**
 * Beregn gennemsnitlig m²-pris for et område baseret på reference-salg.
 */
export function beregnNabosammenligning(
  referencer: SalgsReference[]
): Nabosammenligning {
  if (referencer.length === 0) {
    return {
      referencer: [],
      gennemsnitM2Pris: 0,
      medianM2Pris: 0,
      antalReferencer: 0,
      sammenligningsPeriode: 'Ingen data',
    };
  }

  const m2Priser = referencer.map((r) => r.m2Pris).sort((a, b) => a - b);
  const sum = m2Priser.reduce((a, b) => a + b, 0);
  const gennemsnit = sum / m2Priser.length;
  const median =
    m2Priser.length % 2 === 0
      ? (m2Priser[m2Priser.length / 2 - 1] + m2Priser[m2Priser.length / 2]) / 2
      : m2Priser[Math.floor(m2Priser.length / 2)];

  return {
    referencer,
    gennemsnitM2Pris: Math.round(gennemsnit),
    medianM2Pris: Math.round(median),
    antalReferencer: referencer.length,
    sammenligningsPeriode: 'Seneste 2 år',
  };
}
