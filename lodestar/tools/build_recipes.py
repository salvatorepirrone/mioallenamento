# Genera lodestar/recipes-seed.json: ricette base con i macro calcolati dagli ingredienti (valori per 100 g, indicativi).
# Uso: python lodestar/tools/build_recipes.py
import json, os

# kcal, proteine, carboidrati, grassi per 100 g (peso crudo, salvo dove indicato "cotto"/"scatola")
DB = {
    'pasta': (350, 12, 72, 1.5), 'riso': (350, 7, 78, 0.6), 'farro': (340, 13, 67, 2.5), 'orzo': (350, 10, 73, 1.2),
    'quinoa': (368, 14, 64, 6), 'couscous': (360, 13, 73, 1.8), 'pane integrale': (250, 9, 45, 3),
    'patate': (77, 2, 17, 0.1), 'patate dolci': (86, 1.6, 20, 0.1),
    'petto di pollo': (110, 23, 0, 1.5), 'fesa di tacchino': (105, 23.5, 0, 1), 'manzo magro macinato': (130, 21, 0, 5),
    'controfiletto di manzo': (140, 22, 0, 5.5), 'fettine di manzo': (120, 21.5, 0, 3.5), 'filetto di maiale': (110, 21, 0, 3),
    'vitello macinato': (110, 20, 0, 3), 'salmone': (200, 20, 0, 13), 'merluzzo': (82, 18, 0, 0.7), 'tonno al naturale': (110, 25, 0, 1),
    'gamberi': (85, 18, 0, 1), 'orata': (100, 19, 0, 2.5), 'branzino': (97, 18, 0, 2.5), 'polpo': (82, 15, 2, 1),
    'ceci cotti': (120, 7, 17, 2.5), 'lenticchie cotte': (110, 8, 17, 0.5), 'fagioli cotti': (100, 7, 15, 0.5),
    'piselli': (80, 5.5, 10, 0.4), 'tofu': (120, 13, 2, 7), 'uova': (140, 12.5, 1, 10), 'albumi': (45, 11, 0.5, 0),
    'ricotta': (150, 9, 3, 11), 'feta': (265, 14, 4, 21), 'yogurt greco 0%': (55, 10, 4, 0.2), 'mozzarella light': (170, 18, 1, 10),
    'parmigiano': (390, 33, 0, 28), 'fiocchi di latte': (95, 12, 3, 4),
    'zucchine': (17, 1.5, 2, 0.3), 'spinaci': (23, 3, 1, 0.4), 'pomodorini': (20, 1, 3.5, 0.2), 'broccoli': (34, 3, 4, 0.4),
    'insalata mista': (18, 1.5, 2, 0.2), 'peperoni': (28, 1, 5, 0.3), 'rucola': (25, 2.6, 3.6, 0.7), 'melanzane': (24, 1, 4, 0.3),
    'fagiolini': (30, 2, 5, 0.2), 'funghi': (25, 3, 1, 0.3), 'cipolla': (40, 1, 9, 0.1), 'carote': (36, 1, 8, 0.2),
    'avocado': (160, 2, 2, 15), 'olio extravergine': (900, 0, 0, 100), 'olive': (115, 1, 2, 11), 'mandorle': (600, 21, 10, 53),
    'noci': (650, 15, 7, 65), 'hummus': (230, 8, 14, 16), 'passata di pomodoro': (30, 1.5, 5, 0.2), 'banana': (90, 1, 20, 0.3),
    'frutti di bosco': (45, 1, 9, 0.4), 'mela': (52, 0.3, 12, 0.2),
}

# (nome, categoria, pasto, tempo_min, ingredienti[(nome, grammi)], preparazione)
R = [
 # --- pollo ---
 ('Pollo al limone con riso e zucchine', 'pollo', 'entrambi', 25, [('petto di pollo', 180), ('riso', 80), ('zucchine', 200), ('olio extravergine', 12)], 'Cuoci il riso. Rosola il pollo a fettine con poco olio, aggiungi succo di limone e le zucchine a rondelle; cuoci 8-10 minuti.'),
 ('Petto di pollo alla piastra con patate e insalata', 'pollo', 'entrambi', 30, [('petto di pollo', 180), ('patate', 300), ('insalata mista', 100), ('olio extravergine', 12)], 'Patate a cubetti al forno a 200 °C per 25 minuti. Pollo alla piastra 5 minuti per lato. Condisci l\'insalata con olio e limone.'),
 ('Bowl di pollo, quinoa e avocado', 'pollo', 'pranzo', 25, [('petto di pollo', 160), ('quinoa', 80), ('avocado', 60), ('pomodorini', 120), ('insalata mista', 60), ('olio extravergine', 8)], 'Lessa la quinoa. Griglia il pollo a strisce. Componi la bowl con avocado, pomodorini e insalata.'),
 ('Straccetti di pollo con peperoni e couscous', 'pollo', 'entrambi', 20, [('petto di pollo', 170), ('peperoni', 200), ('couscous', 80), ('olio extravergine', 12)], 'Idrata il couscous con acqua calda. Salta il pollo a straccetti con i peperoni a listarelle 10 minuti.'),
 ('Pollo al curry leggero con riso e spinaci', 'pollo', 'cena', 30, [('petto di pollo', 170), ('riso', 80), ('spinaci', 200), ('yogurt greco 0%', 60), ('olio extravergine', 10)], 'Rosola il pollo a cubetti con curry, aggiungi yogurt e spinaci, cuoci 10 minuti. Servi sul riso.'),
 ('Tacchino al forno con patate dolci e fagiolini', 'pollo', 'cena', 35, [('fesa di tacchino', 190), ('patate dolci', 250), ('fagiolini', 200), ('olio extravergine', 12)], 'Patate dolci a spicchi in forno a 200 °C per 25 minuti. Tacchino in padella con rosmarino. Fagiolini lessati.'),
 ('Insalata di pollo, ceci e pomodorini', 'pollo', 'pranzo', 15, [('petto di pollo', 150), ('ceci cotti', 150), ('pomodorini', 150), ('insalata mista', 80), ('pane integrale', 60), ('olio extravergine', 12)], 'Griglia il pollo e taglialo a pezzi; unisci ceci, pomodorini e insalata. Pane integrale a parte.'),
 # --- carne ---
 ('Hamburger di manzo magro con patate al forno', 'carne', 'cena', 30, [('manzo magro macinato', 180), ('patate', 300), ('insalata mista', 100), ('olio extravergine', 12)], 'Forma l\'hamburger e cuocilo alla piastra. Patate a spicchi in forno a 200 °C per 25 minuti. Insalata a parte.'),
 ('Spaghetti al ragù magro', 'carne', 'pranzo', 40, [('pasta', 90), ('manzo magro macinato', 120), ('passata di pomodoro', 150), ('cipolla', 40), ('carote', 40), ('olio extravergine', 10)], 'Soffriggi cipolla e carota, aggiungi il macinato e la passata, cuoci 25 minuti. Condisci la pasta.'),
 ('Straccetti di manzo con rucola e patate', 'carne', 'cena', 25, [('fettine di manzo', 180), ('rucola', 60), ('patate', 280), ('pomodorini', 80), ('olio extravergine', 12)], 'Patate al forno. Manzo a straccetti scottato 3 minuti in padella calda; servi su rucola e pomodorini.'),
 ('Filetto di maiale con farro e broccoli', 'carne', 'pranzo', 35, [('filetto di maiale', 180), ('farro', 80), ('broccoli', 250), ('olio extravergine', 12)], 'Cuoci il farro. Rosola il filetto a medaglioni 4 minuti per lato. Broccoli al vapore.'),
 ('Polpette di vitello al sugo con riso', 'carne', 'pranzo', 40, [('vitello macinato', 170), ('riso', 80), ('passata di pomodoro', 150), ('uova', 30), ('parmigiano', 10), ('olio extravergine', 8)], 'Impasta vitello, uovo e parmigiano; forma le polpette e cuocile nel sugo 20 minuti. Servi con il riso.'),
 ('Controfiletto con patate e spinaci', 'carne', 'cena', 25, [('controfiletto di manzo', 180), ('patate', 280), ('spinaci', 200), ('olio extravergine', 12)], 'Patate al forno. Controfiletto in padella 3-4 minuti per lato. Spinaci saltati con aglio.'),
 ('Chili di manzo e fagioli con riso', 'carne', 'pranzo', 40, [('manzo magro macinato', 130), ('fagioli cotti', 150), ('passata di pomodoro', 150), ('riso', 70), ('peperoni', 100), ('olio extravergine', 8)], 'Rosola il macinato con peperoni, aggiungi passata, fagioli e spezie; cuoci 25 minuti. Servi con il riso.'),
 # --- pesce ---
 ('Salmone al forno con patate e broccoli', 'pesce', 'cena', 30, [('salmone', 150), ('patate', 250), ('broccoli', 250), ('olio extravergine', 8)], 'Salmone e patate a cubetti in forno a 200 °C per 20-25 minuti. Broccoli al vapore.'),
 ('Merluzzo al pomodoro con couscous', 'pesce', 'cena', 25, [('merluzzo', 220), ('pomodorini', 200), ('couscous', 80), ('olive', 20), ('olio extravergine', 10)], 'Cuoci il merluzzo in padella con pomodorini e olive 10 minuti. Servi con il couscous.'),
 ('Pasta al tonno e pomodorini', 'pesce', 'pranzo', 20, [('pasta', 90), ('tonno al naturale', 120), ('pomodorini', 200), ('olio extravergine', 12)], 'Cuoci la pasta. Scalda i pomodorini con olio, unisci il tonno sgocciolato e manteca.'),
 ('Orata al cartoccio con patate e zucchine', 'pesce', 'cena', 35, [('orata', 250), ('patate', 250), ('zucchine', 200), ('olio extravergine', 12)], 'Cartoccio con orata, patate a fette e zucchine; forno a 190 °C per 30 minuti.'),
 ('Gamberi e zucchine con orzo', 'pesce', 'pranzo', 25, [('gamberi', 200), ('zucchine', 200), ('orzo', 80), ('olio extravergine', 12)], 'Cuoci l\'orzo. Salta i gamberi con le zucchine, aglio e prezzemolo 6-7 minuti. Unisci.'),
 ('Insalata di tonno, fagioli e cipolla', 'pesce', 'pranzo', 10, [('tonno al naturale', 130), ('fagioli cotti', 200), ('cipolla', 40), ('pomodorini', 100), ('pane integrale', 70), ('olio extravergine', 12)], 'Mescola tutti gli ingredienti con olio e limone. Pane integrale a parte.'),
 ('Branzino con riso e spinaci', 'pesce', 'cena', 30, [('branzino', 250), ('riso', 80), ('spinaci', 200), ('olio extravergine', 10)], 'Branzino al forno 20 minuti a 190 °C con limone. Riso lessato e spinaci saltati.'),
 ('Insalata di polpo e patate con fagiolini', 'pesce', 'pranzo', 40, [('polpo', 200), ('patate', 250), ('fagiolini', 150), ('olio extravergine', 14)], 'Lessa polpo, patate e fagiolini; taglia tutto a pezzi e condisci con olio, limone e prezzemolo.'),
 # --- legumi ---
 ('Pasta e ceci', 'legumi', 'pranzo', 30, [('pasta', 70), ('ceci cotti', 200), ('passata di pomodoro', 80), ('cipolla', 30), ('olio extravergine', 12)], 'Soffriggi cipolla, aggiungi passata e ceci, cuoci 10 minuti. Cuoci la pasta nel sugo.'),
 ('Zuppa di lenticchie e verdure con pane', 'legumi', 'cena', 35, [('lenticchie cotte', 250), ('carote', 80), ('cipolla', 40), ('spinaci', 150), ('pane integrale', 90), ('olio extravergine', 12)], 'Soffriggi cipolla e carota, aggiungi lenticchie, spinaci e acqua; cuoci 15 minuti. Pane integrale tostato.'),
 ('Bowl di ceci, quinoa e hummus', 'legumi', 'pranzo', 20, [('ceci cotti', 150), ('quinoa', 70), ('hummus', 50), ('pomodorini', 120), ('insalata mista', 60), ('olio extravergine', 6)], 'Lessa la quinoa; componi la bowl con ceci, hummus, pomodorini e insalata.'),
 ('Lenticchie al curry con riso e spinaci', 'legumi', 'cena', 30, [('lenticchie cotte', 250), ('riso', 70), ('spinaci', 200), ('cipolla', 40), ('olio extravergine', 12)], 'Soffriggi cipolla con curry, aggiungi lenticchie e spinaci, cuoci 10 minuti. Servi con il riso.'),
 ('Pasta e fagioli leggera', 'legumi', 'pranzo', 30, [('pasta', 70), ('fagioli cotti', 220), ('passata di pomodoro', 80), ('carote', 40), ('olio extravergine', 12)], 'Cuoci i fagioli con soffritto e passata, frullane metà, aggiungi la pasta e finisci la cottura.'),
 ('Tofu saltato con verdure e riso', 'legumi', 'cena', 25, [('tofu', 200), ('riso', 80), ('broccoli', 150), ('peperoni', 100), ('olio extravergine', 10)], 'Salta il tofu a cubetti con le verdure e un goccio di salsa di soia. Servi con il riso.'),
 ('Polpette di ceci e zucchine con insalata', 'legumi', 'cena', 35, [('ceci cotti', 250), ('zucchine', 120), ('uova', 40), ('pane integrale', 70), ('insalata mista', 100), ('olio extravergine', 12)], 'Schiaccia i ceci, unisci zucchine grattugiate e uovo; forma le polpette e cuoci in forno a 200 °C per 20 minuti.'),
 ('Insalata di farro, fagioli e verdure', 'legumi', 'pranzo', 20, [('farro', 80), ('fagioli cotti', 180), ('pomodorini', 150), ('peperoni', 100), ('olio extravergine', 14)], 'Cuoci il farro, fallo raffreddare e condiscilo con fagioli, pomodorini, peperoni, olio e limone.'),
 # --- uova e latticini ---
 ('Frittata di zucchine e ricotta con pane', 'uova', 'cena', 25, [('uova', 150), ('zucchine', 200), ('ricotta', 80), ('pane integrale', 80), ('olio extravergine', 8)], 'Sbatti le uova con la ricotta, unisci le zucchine saltate e cuoci in padella o al forno 12 minuti.'),
 ('Omelette ai funghi e spinaci con patate', 'uova', 'cena', 25, [('uova', 150), ('funghi', 150), ('spinaci', 100), ('patate', 250), ('olio extravergine', 10)], 'Patate al forno. Salta funghi e spinaci, versa le uova e cuoci l\'omelette.'),
 ('Insalata greca con feta e orzo', 'uova', 'pranzo', 15, [('feta', 70), ('orzo', 80), ('pomodorini', 150), ('olive', 25), ('cipolla', 30), ('olio extravergine', 10)], 'Cuoci l\'orzo e raffreddalo. Unisci feta a cubetti, pomodorini, olive e cipolla.'),
 ('Pasta con ricotta e spinaci', 'uova', 'pranzo', 20, [('pasta', 90), ('ricotta', 100), ('spinaci', 200), ('parmigiano', 10)], 'Cuoci la pasta; salta gli spinaci, unisci ricotta e un mestolo di acqua di cottura; manteca.'),
 ('Uova strapazzate con avocado e pane', 'uova', 'pranzo', 10, [('uova', 150), ('avocado', 80), ('pane integrale', 100), ('pomodorini', 100)], 'Strapazza le uova in padella antiaderente. Servi con avocado a fette, pane tostato e pomodorini.'),
 ('Insalata di fiocchi di latte, uova e patate', 'uova', 'cena', 20, [('fiocchi di latte', 150), ('uova', 100), ('patate', 250), ('fagiolini', 150), ('olio extravergine', 10)], 'Lessa patate, fagiolini e uova; taglia e condisci con i fiocchi di latte, olio e limone.'),
 ('Caprese proteica con uova sode e pane', 'uova', 'cena', 10, [('mozzarella light', 150), ('pomodorini', 200), ('uova', 100), ('pane integrale', 100), ('olio extravergine', 10)], 'Affetta mozzarella e pomodori, aggiungi le uova sode a spicchi, basilico e olio. Pane a parte.'),
 ('Riso con uovo e piselli', 'uova', 'pranzo', 20, [('riso', 90), ('piselli', 150), ('uova', 100), ('parmigiano', 15), ('olio extravergine', 8)], 'Cuoci il riso con i piselli; manteca con parmigiano e completa con uova sode a pezzi.'),
]

def build():
    out = []
    for i, (name, cat, meal, mins, ings, how) in enumerate(R, 1):
        kcal = p = c = f = 0.0
        items = []
        for n, g in ings:
            k, pp, cc, ff = DB[n]
            kcal += k * g / 100; p += pp * g / 100; c += cc * g / 100; f += ff * g / 100
            items.append({'name': n, 'grams': g})
        out.append({'id': 's%02d' % i, 'name': name, 'category': cat, 'meal': meal, 'time_min': mins,
                    'kcal': round(kcal), 'protein': round(p), 'carbs': round(c), 'fat': round(f),
                    'ingredients': items, 'steps': how, 'added_by': 'Lodestar', 'seed': True})
    return out

if __name__ == '__main__':
    data = build()
    path = os.path.join(os.path.dirname(__file__), '..', 'recipes-seed.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    for r in data:
        print('%-3s %-48s %-6s %4d kcal  P%3d C%3d G%3d' % (r['id'], r['name'][:48], r['category'], r['kcal'], r['protein'], r['carbs'], r['fat']))
    print(len(data), 'ricette')
