import express, { Express } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import axios from 'axios';
import { map, from, lastValueFrom, mergeMap, defer, toArray, bufferCount, concatMap, forkJoin } from 'rxjs';
import retry from 'async-retry';
import { URL } from 'node:url';
import { stringify } from "node:querystring";
import dotenv from 'dotenv';
import moment from 'moment';
dotenv.config({path: `${__dirname}/../.env`});

interface InitialInputData {
  page: String
  dateInit: String
  dateFinish: String
  status: String
  type: String
  environment: String
}

const corsAddresses: string[] = [
  'http://localhost:3300',
];

class AppController {
  express: Express;

  constructor() {
    this.express = express();
    this.middlewares();
  }

  middlewares() {
    this.express.use(bodyParser.json({ limit: '50mb' }));
  }
}

// ### Environment variables
const production = process.env.NODE_ENV === 'production';
const {
  TOKEN_URL,
  TOKEN_BODY,
  DATA_URL,
  WORKSPACE,
  DEDUZIR,
  REQUESTS_AMT
} = process.env as { [varName: string]: string };

const app: Express = new AppController().express;
if (production) {
  app.use(cors({ origin: corsAddresses }));
} else {
  app.use(cors({ origin: true }));
}

// faz requisições http
const axiosReq = {
  post: async (url: string, payload: InitialInputData | undefined, config: any): Promise<{ response?: any; error?: any; }> => {
    try {
      const response = await retry(
        async (bail) => {
          // if anything throws, we retry
          const { data } = await axios.post(url, payload, config)
          return data;
        },
        {
          retries: 5,
        }
      );
      return { response: response.data, error: undefined }
    } catch (error: any) {
      return { response: undefined, error: error.message }
    }
  },
  get: async (url: string, config: any,): Promise<{ response?: any; error?: any; }> => {
    try {
      const response = await retry(
        async (bail) => {
          // if anything throws, we retry
          const data = await axios.get(url, config)
          return data;
        },
        {
          retries: 5,
        }
      );
      return { response: response.data, error: undefined }
    } catch (error: any) {
      return { response: undefined, error: error.message }
    }
  }
}



const getToken = async () => {
  const token =  await axiosReq.post(
      TOKEN_URL, 
      JSON.parse(TOKEN_BODY), 
      {headers: {'Content-Type': 'application/json'}}
    );
  return token.response.token
} 

const createUrl = (params: any, n: Number): String => {
  try {
    const newURL = new URL(`${DATA_URL}?${`page=${n}&${params}`}`);
    return newURL.href
  } catch (error: any) {
    return error
  }
}

const loopForAllData = async (urlArray: String[], token: String) => {
  const amount = Number(REQUESTS_AMT)
  const dataToTest$ = from(urlArray).pipe(
    bufferCount(1),
    map((url: any) => {
      const config = {
        headers: {
          Workspace: WORKSPACE,
          Authorization: `Bearer ${token}`
        }
      };
      return {
        url,
        config,
      };
    }),
    mergeMap(
      ({url, config}) => forkJoin({
      results: axiosReq.get(url, config),
    }), amount),
    toArray(),
    map(async (data: any, i) => {
      console.log(`Coleta de dados finalizada`);
      const results: any[] = []
      data.map(
        (d: any) => d.results.response.data).map((d: any) => results.push(...d))
      return results;
    })
  );
  const dataToTest = await lastValueFrom(dataToTest$);
  return dataToTest;
}

// endpoint de cominicação com o frontend
app.post('/', async (req, res) => {
  res.set('Access-Controll-Allow-Origin', '*');
  res.set('Access-Controll-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }
  try {
    const payload : any = { ...req.body };
    console.log('Pegar token');
    const token = await getToken()
    console.log('Verificar quantidade de páginas');
    const url: any = createUrl(stringify(payload), 1)
    const config = {
      headers: {
        Workspace: WORKSPACE,
        Authorization: `Bearer ${token}`
      }
    };
    let start = Date.now();
    const pageNum = await axiosReq.get(url, config)
    const requestDataArray: String[] = [];
    const deduzir = parseInt(DEDUZIR, 10)
    console.log('Criando lista de requisições');
    console.log(`Foi deduzido ${deduzir} requsições, conforme configurado no arquivo .env`);
    console.log(`Considerando as deduções, ${pageNum.response.pages - deduzir} requsições serão realizadas`);
    let timeTaken = Date.now() - start;
    var tempTime = moment.duration(timeTaken * (pageNum.response.pages - deduzir));
    var tempoEstimado = `${moment.duration(tempTime).minutes()} minutos`;
    console.log("tempo estimado de: " + tempoEstimado);
    for (let i = 1; i <= pageNum.response.pages - deduzir; i++) {
      requestDataArray.push(createUrl(stringify(payload), i))
    }
    const response = await loopForAllData(requestDataArray, token)
    console.log('Fim...');
    return res.status(200).send(response);
  } catch (error: any) {
    console.log(JSON.stringify(req.body));
    console.log(JSON.stringify(error));
    return res.status(500).send(error.message);
  }
});

export default app;
export {
  app,
};