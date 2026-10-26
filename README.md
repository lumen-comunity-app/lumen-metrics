# Lumen Metrics Dashboard

Painel Next.js para acompanhar as métricas da API Lumen em português.

## Executar localmente

Requer Node.js 20.9 ou superior.

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) e informe o `METRICS_TOKEN` configurado no backend. A URL do backend pode ser alterada em `BACKEND_API_URL` no arquivo `.env.local` (padrão: `http://localhost:8080`). Essa variável é lida somente no servidor.

O token é mantido apenas na memória da página e enviado ao backend pela rota servidor `/api/metrics`; não é armazenado no navegador. O painel atualiza os dados a cada 10 segundos e mantém tendências apenas enquanto a página está aberta.

## Produção

Configure `BACKEND_API_URL` no ambiente do processo Next.js para a URL alcançável pelo servidor Next, instale as dependências e execute:

```powershell
npm run build
npm run start
```
