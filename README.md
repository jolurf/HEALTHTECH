# criar a venv
python -m venv venv

# ativar a venv
source venv/bin/activate

# instalar requirements.txt

pip install -r requirements.txt

# Executar

cd ./backend
source venv/bin/activate
uvicorn main:app --reload

# Abrir browser e dar run no /frontend/index.html
firefox ./frontend/index.html


# Comandos Basicos

cd existing_repo
git remote add origin http://gitlab.plnmed.incor.usp.br/joao.freitas/projeto_app_avaliadores.git
git branch -M main
git push -uf origin main
