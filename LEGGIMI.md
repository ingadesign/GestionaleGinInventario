# Inventario GiN APS

Sito statico (nessun server da gestire) che usa Supabase per database, login dei soci e archivio di fatture e scontrini.
Si pubblica su qualsiasi hosting e si collega a un vostro dominio, per esempio `inventario.gin-aps.it`.

Tempo previsto: circa 30 minuti, senza scrivere codice.

## 1. Creare il progetto Supabase

1. Registrati su https://supabase.com e crea un nuovo progetto.
2. Scegli la regione **Frankfurt (eu-central-1)** così i dati restano in Europa. Metti una password forte e salvala.
3. Quando il progetto è pronto, apri **SQL Editor > New query**.
4. Incolla tutto il contenuto di `supabase/schema.sql` e premi **Run**. Crea tabelle, permessi, storico automatico e archivio file.
5. Fai lo stesso con `supabase/seed.sql`. Importa i beni e i progetti che erano nell'Excel. **Eseguilo una volta sola.**

## 2. Impostare l'accesso dei soci

In **Authentication**:
1. **Sign In / Providers > Email**: lascia attivo il provider Email. Se trovi l'opzione, disattiva **Allow new users to sign up**. Così entra solo chi invitate voi.
2. **URL Configuration**: in *Site URL* scrivi l'indirizzo finale del sito (per esempio `https://inventario.gin-aps.it`). Aggiungi lo stesso indirizzo in *Redirect URLs*.
3. **Users > Invite user**: invita per email te e gli altri soci.
   - **La prima persona che si registra diventa amministratore.** Invita prima te stessa e fai il primo accesso, poi gli altri.
   - Ognuno diventa "socio": inserisce e modifica i beni, carica documenti, stampa etichette.
   - L'amministratore in più può creare e modificare i progetti, cambiare le impostazioni ed eliminare i beni.
4. Per rendere amministratore un altro socio, in SQL Editor:
   `update public.members set ruolo = 'admin' where email = 'nome@esempio.it';`

Le email di invito e di accesso partono dal servizio gratuito di Supabase, che ha un limite di invii all'ora. Se i soci sono molti, conviene collegare un servizio email vostro in **Authentication > SMTP Settings**.

## 3. Collegare il sito al database

1. In Supabase: **Project Settings > API**. Copia **Project URL** e la chiave **anon public**.
2. Apri `config.js` e incolla i due valori al posto dei segnaposto.

La chiave anon può stare nel sito: chi la vede non ottiene niente senza essere un socio che ha fatto l'accesso. A proteggere i dati sono le regole del database.

## 4. Pubblicare sul vostro dominio

Carica l'intera cartella (tutti i file, compresi `vendor` e `fonts`) su uno di questi servizi:

- **Cloudflare Pages** o **Netlify**: trascini la cartella nella pagina "deploy manuale". Sono gratuiti per un sito statico.
- **Il vostro hosting**: copia i file nella cartella pubblica via FTP.

Poi, nelle impostazioni del servizio, aggiungi il dominio personalizzato. Ti dice quale record **CNAME** inserire dove avete comprato il dominio.

## 5. Primo avvio

1. Apri il sito e inserisci la tua email: arriva un link per entrare.
2. In **Impostazioni** inserisci:
   - il tuo nome, che compare nello storico delle modifiche;
   - il link alla cartella Tesoreria;
   - **l'indirizzo del sito**, per far funzionare il QR code sulle etichette.
3. In **Progetti e fondi** controlla il testo che finisce sulle etichette e correggilo con la dicitura richiesta dal finanziatore.

## Come funziona

- Ogni bene ha un numero (`13`, oppure `3C` per i consumi) e una scheda con fonte dei fondi, importo, data, metodo di pagamento e fattura.
- Fatture e scontrini si caricano sulla scheda (PDF o foto). Sono privati e si aprono con un link temporaneo.
- Chi inserisce o modifica un bene viene registrato **dal database** nello storico. L'app non può saltare questo passaggio.
- Le etichette si scaricano in PDF A4 dalla scheda "Etichette".
- Da "Beni" > **Esporta CSV** si ottiene un file per rendiconti e backup.

## Cose da sapere

- **Progetto in pausa**: i progetti del piano gratuito di Supabase vengono messi in pausa dopo circa una settimana senza visite. Si riattivano dalla dashboard. Per un uso continuo conviene il piano a pagamento, che ha anche backup automatici.
- **Backup**: finché usate il piano gratuito, scarica ogni tanto il CSV e salva una copia della cartella dei documenti (Storage > documenti).
- **File eliminati**: se un amministratore elimina un bene, i suoi file restano nell'archivio finché non li togli da Supabase > Storage.
- **Numerazione**: il numero del nuovo bene è il successivo più alto. Se due soci inseriscono nello stesso istante, uno dei due vede un errore e riprova.
- **Dicitura delle etichette**: ho scritto "Corpo europeo di solidarietà" come programma per i progetti con codice ESC30. Verifica con le regole del finanziatore la dicitura esatta e l'eventuale logo UE.
