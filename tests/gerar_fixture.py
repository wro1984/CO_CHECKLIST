"""Gera tests/fixtures/pacote.json com as funções do PRÓPRIO MAPI (checklist_app.py), com dados inventados.

    MAPI_DIR=/caminho/do/mapi5 python tests/gerar_fixture.py

A pessoa de teste é A0001 / lago-vento-pedra (a mesma do pacote de exemplo do HUB). Os números são inventados por um
gerador fixo (mesma semente, mesmo arquivo): nada real.
"""
import base64
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.environ["MAPI_DIR"])
import checklist_app  # noqa: E402
import hub  # noqa: E402

MAT, CHAVE = "A0001", "lago-vento-pedra"
BRT = timezone(timedelta(hours=-3))
AGORA = datetime(2026, 11, 12, 15, 5, 2, tzinfo=BRT)
rnd = random.Random(11)
FRENTES = ["TRIAGEM", "MANOBRA", "ENRIQUECIMENTO", "MAGIC", "CO", "TEL", "CO_SISTEMICO"]


def blocos(inicio, fim):
    t = inicio
    while t <= fim:
        yield t
        t += timedelta(minutes=15)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M")


series = {}
for f in FRENTES:
    escala = {"MAGIC": 14, "TRIAGEM": 6, "MANOBRA": 10}.get(f, 4)
    pts = []
    for t in blocos(datetime(2026, 11, 11, 15, 0), datetime(2026, 11, 12, 15, 0)):
        if rnd.random() < 0.35:
            continue                                   # blocos sem execução não vêm
        a = rnd.randint(0, escala)
        e = rnd.randint(0, max(1, escala // 3))
        if a + e:
            pts.append([iso(t), a, e])
    series[f] = pts

colunas = ["t", "total", "MANOBRA", "CO_SISTEMICO", "MONITORAMENTO", "TRIAGEM", "ENRIQUECIMENTO", "MAGIC", "CO", "TEL_ICOMON"]
linhas = []
for t in blocos(datetime(2026, 11, 12, 0, 0), datetime(2026, 11, 12, 15, 0)):
    v = [rnd.randint(0, 18), rnd.randint(0, 3), 0, rnd.randint(0, 25), rnd.randint(0, 6), rnd.randint(10, 60), rnd.randint(0, 9), 0]
    linhas.append([iso(t), sum(v)] + v)

snapshot = {
    "v": 1, "coletado_em": AGORA.isoformat(timespec="seconds"),
    "fila": {"aguardando": 1, "executando": 37},
    "aguardando_frente": {"MAGIC": 1},
    "execucao_frente": {"TOTAL": 37, "MAGIC": 20, "MANOBRA": 12, "TRIAGEM": 2, "ENRIQUECIMENTO": 3},
    "hoje_frente": {"TOTAL": 8375, "MAGIC": 3998, "TRIAGEM": 1498, "MANOBRA": 1210, "ENRIQUECIMENTO": 905, "CO": 560, "TEL_ICOMON": 204},
    "rede_magic": {"VIVO1": 2632, "VIVO2": 1366},
    "series": series,
    "acompanhamento": {"colunas": colunas, "linhas": linhas},
    "bancos": {"b162": {"total": 166, "max": 300, "estados_completos": False, "estados": None},
               "b242": {"total": 251, "max": 400, "estados_completos": True, "estados": {"active": 9, "idle": 232, "background": 10}}},
    "hardware": {"cpu_pct": 24.7, "mem_pct": 72.4, "mem_total": 16867405824, "mem_usada": 12210000000, "uptime_s": 1728000,
                 "load1": 0.8, "discos": [{"ponto": "/", "total": 270553174016, "usado": 10986254336, "pct": 4.1},
                                          {"ponto": "/data", "total": 107374182400, "usado": 98784247808, "pct": 92.0}]},
    "parciais": {},
}
def ev(uid, regra, nome, sev, aberto, fechado, valor, pico, limite, detalhe, chave=""):
    return {"id": uid, "regra": regra, "chave": chave, "nome": nome, "sev": sev, "valor": valor, "pico": pico, "limite": limite,
            "detalhe": detalhe, "aberto_em": aberto.astimezone(timezone.utc).isoformat(), "fechado_em": fechado.astimezone(timezone.utc).isoformat() if fechado else None}


H = timedelta(hours=1)
EVENTOS = {"dias": 7, "abertos": [
    ev("a1", "mem", "Memória da máquina alta", "aviso", AGORA - 25 * timedelta(minutes=1), None, 82.1, 84.0, 80, "82,1%"),
    ev("a2", "disco", "Disco cheio", "critico", AGORA - 3 * H, None, 96.0, 96.0, 95, "/data a 96%", "/data")],
    "historico": [
    ev("h1", "cpu", "CPU da máquina alta", "critico", AGORA - 6 * H, AGORA - 5 * H - 20 * timedelta(minutes=1), 97.0, 99.0, 95, "97%"),
    ev("h2", "coletor", "Coletor de dados", "critico", AGORA - 26 * H, AGORA - 25 * H - 40 * timedelta(minutes=1), 2, 2, 2, "Coletor da 162 sem sinal há 9 min"),
    ev("h3", "reinicio", "Máquina da 162 reiniciada", "aviso", AGORA - 30 * H, AGORA - 30 * H, 540, 540, None, "ligada há 9 min"),
    ev("h4", "conn242", "Conexões do banco 242", "aviso", AGORA - 50 * H, AGORA - 49 * H, 82.0, 85.5, 80, "340 de 400 conexões (85%)")]}
prog = {"ativo": True, "intervalo_min": 5, "hora_inicio": "00:00", "hora_fim": "23:59"}
snap = {"id": 412, "coletado_em": AGORA, "duracao_ms": 4820, "versao_agente": "1.0.0", "host": "h", "dados": snapshot}

salt = os.urandom(16)
segredo = os.urandom(32)                       # segredo de aviso (push) inventado, vai cifrado em `tk`
pessoa = {"matricula": MAT, "salt": salt, "chave": hub.chave_do_codigo(CHAVE, salt), "push_secret": segredo}
conteudo = json.loads(json.dumps(checklist_app.montar_conteudo(snap, prog), default=str))
conteudo["eventos"] = EVENTOS
VAPID = "BEXEMPLO-chave-publica-inventada"
pacote = checklist_app.montar_pacote(conteudo, [pessoa], VAPID)
# prova de uma inscrição inventada, calculada pelo MAPI: o app tem que chegar no mesmo valor
insc = {"endpoint": "https://fcm.googleapis.com/fcm/send/exemplo", "p256dh": "B" + "x" * 86, "auth": "y" * 22}
saida = {"hub": {"matricula": MAT, "chave": CHAVE, "salt": base64.b64encode(salt).decode(), "iter": hub.ITERACOES},
         "pacote": pacote, "esperado": conteudo,
         "push": {"chave": VAPID, "segredo": base64.b64encode(segredo).decode(), "inscricao": insc,
                  "mac": checklist_app.mac_inscricao(segredo, insc["endpoint"], insc["p256dh"], insc["auth"])}}
destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "pacote.json")
with open(destino, "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False, indent=1)
print("gravado:", destino)
