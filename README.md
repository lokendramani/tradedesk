# TradeDesk — Trading Journal Application

Multi-user trading journal with Django backend and React frontend.

## Tech Stack
- **Backend**: Django 4.2 + Django REST Framework + PostgreSQL
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Database**: PostgreSQL (Supabase)
- **Auth**: JWT

## Local Setup

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env         # Fill in your values
python manage.py migrate
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env         # Fill in your values
npm run dev
```

## Environment Variables

### Backend (.env)
SECRET_KEY=
DEBUG=True
DATABASE_URL=
JWT_ACCESS_TOKEN_LIFETIME_HOURS=24
CORS_ALLOWED_ORIGINS=http://localhost:5173
### Frontend (.env)
VITE_API_URL=http://localhost:8000/api