import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Bypass SSL certificate errors from Vendizap in dev
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Allow 5 minutes for this request to complete (it's a heavy scraper)
export const maxDuration = 300; 
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(req: Request) {
  try {
    let allProducts: any[] = [];
    let page = 0;
    
    // 1. Fetch from Vendizap API
    while (true) {
        const payload = {
            "idUsuario": "633e0f5ae20456715d1067a4",
            "textoPesquisa": "",
            "categoria": [],
            "filtrosVitrine": {
                "texto": "",
                "precoMin": 0,
                "precoMax": 0,
                "variacoes": []
            },
            "isTabela": true,
            "permiteCache": true,
            "tipoCache": "geral",
            "produtoURL": null,
            "isMobile": false,
            "paginaGerais": page,
            "paginaPromocoes": 0
        };

        const res = await fetch('https://app.vendizap.com/webservice/Vitrine/carregarVitrine', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://brandcollectionfabricasp.vendizap.com',
                'Referer': 'https://brandcollectionfabricasp.vendizap.com/'
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            return NextResponse.json({ error: 'Failed to fetch from supplier' }, { status: 502 });
        }

        const data = await res.json();
        const galeria = data.listas?.listaGaleria || [];
        allProducts.push(...galeria);
        
        if (galeria.length === 0) break;
        page++;
        
        // Safety break
        if (page > 30) break;
    }
    
    // 2. Filter Target Categories
    const targetCategories = [
        "66a29d6d82566b4ded35b45b", // TESTER ORIGINAL PERFUME
        "633e196a4bbfb153452e5c63", // Victoria’s Secret 100% original
        "64e9590eae1ccc0f6165d084", // PERFUME ORIGINAL 100%
        "64d5583b95f5fa75b4326b2c"  // PERFUME ÁRABE ORIGINAL
    ];
    
    const filtered = allProducts.filter(p => {
        return p.categorias?.some((c: any) => targetCategories.includes(c.$oid));
    });

    // 3. Upsert to Prisma
    let syncedCount = 0;
    for (const prod of filtered) {
        const externalId = prod._id.$oid;
        const nome = prod.nome;
        const categoriaObj = prod.categorias?.find((c: any) => targetCategories.includes(c.$oid));
        
        // Resolve simple category string name based on target ID
        let catName = 'Importados';
        if (categoriaObj?.$oid === '66a29d6d82566b4ded35b45b') catName = 'Tester';
        if (categoriaObj?.$oid === '633e196a4bbfb153452e5c63') catName = 'Victoria Secret';
        if (categoriaObj?.$oid === '64d5583b95f5fa75b4326b2c') catName = 'Árables';

        const imagem_url = prod.imagemUrl || null;
        const preco_custo = prod.variacoes?.[0]?.preco || prod.preco || 0;
        const estoque = prod.variacoes?.[0]?.estoque || prod.estoque || 0;
        const disponivel = estoque > 0 && !prod.esgotado;

        await prisma.product.upsert({
            where: { external_id: externalId },
            update: {
                nome,
                categoria: catName,
                imagem_url,
                preco_custo,
                estoque,
                disponivel,
                updated_at: new Date()
            },
            create: {
                external_id: externalId,
                nome,
                categoria: catName,
                imagem_url,
                preco_custo,
                preco_venda: 0, // Admin must set resale price manually
                estoque,
                disponivel,
                publicar_no_site: false // Hidden by default
            }
        });
        syncedCount++;
    }
    
    return NextResponse.json({ 
        success: true, 
        message: `Sincronização concluída! Foram processados ${syncedCount} produtos.` 
    });
  } catch (error: any) {
    console.error("Sync Error: ", error);
    return NextResponse.json({ 
      error: 'Erro Interno no Servidor', 
      details: error.message 
    }, { status: 500 });
  }
}
