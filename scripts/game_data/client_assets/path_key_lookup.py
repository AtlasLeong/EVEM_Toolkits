"""Verified, read-only THFB path-key lookup for this client's default package split.

Native evidence: split_pkgname_filename 0x2a0d034, filepath_normalized 0x2a0d2c4,
32-bit path hashing 0x2a5a318, xxhash32 0x2a48094, seed/table loader 0x2a4b6e0.
No native code is loaded. Caller chooses an exact resource extension.
"""
from pathlib import Path
import struct
import xxhash

def normalized(path, case_sensitive=True):
    """Native's current normalization, not its older backslash filepathid."""
    if not isinstance(path,str):raise TypeError('path must be a string')
    if '\0' in path:raise ValueError('NUL paths are not accepted')
    if path.startswith(('/', '\\')):path=path[1:]
    path=path.replace('\\','/')
    if not case_sensitive:
        path=''.join(chr(ord(c)+32) if 'A'<=c<='Z' else c for c in path)
    return path

class THFBPathLookup:
    def __init__(self, file):
        self.source=str(Path(file).resolve())
        self.data=Path(file).read_bytes()
        if self.data[:4] != b'THFB':raise ValueError('not THFB')
        self.root=8+self.u32(8)
        self.child=self.vector(self.root,1)
        self.hasher=self.vector(self.child,1)
        self.key_vector=self.vector(self.hasher,0)
        self.record_vector=self.vector(self.child,0)
        self.count=self.u32(self.key_vector)
        if self.u32(self.record_vector)!=self.count:raise ValueError('key/record count mismatch')
        self.keys=struct.unpack_from(f'<{self.count}I',self.data,self.key_vector+4)
        c=self.vector(self.hasher,1)
        self.collision_keys=set(struct.unpack_from(f'<{self.u32(c)}I',self.data,c+4))
        s=self.vector(self.hasher,2)
        self.seeds=struct.unpack_from(f'<{self.u32(s)}I',self.data,s+4)
        if len(self.seeds)!=2:raise ValueError('expected two path seeds')
        self.indices={}
        for i,key in enumerate(self.keys):
            if key in self.indices:raise ValueError(f'duplicate stored key {key:x}')
            self.indices[key]=i

    def u32(self,offset):return struct.unpack_from('<I',self.data,offset)[0]
    def field(self,table,index):
        vt=table-struct.unpack_from('<i',self.data,table)[0]
        vlen=struct.unpack_from('<H',self.data,vt)[0]
        if 4+index*2>=vlen:raise ValueError('missing field')
        rel=struct.unpack_from('<H',self.data,vt+4+index*2)[0]
        if not rel:raise ValueError('missing field')
        return table+rel
    def vector(self,table,index):
        field=self.field(table,index)
        return field+self.u32(field)

    def key(self,logical_path,case_sensitive=True):
        logical_path=normalized(logical_path,case_sensitive)
        package,separator,relative=logical_path.partition('/')
        if not separator:relative=package;package='inroot'
        primary=xxhash.xxh32(relative,seed=self.seeds[0]).intdigest()
        fallback=primary in self.collision_keys
        key=xxhash.xxh32(relative,seed=self.seeds[1]).intdigest() if fallback else primary
        return {'logicalPath':logical_path,'packageName':package,'relativePath':relative,
                'primaryKey':primary,'tableKey':key,'seed':self.seeds[1] if fallback else self.seeds[0],
                'usedCollisionFallback':fallback}

    def lookup(self,logical_path,case_sensitive=True):
        result=self.key(logical_path,case_sensitive)
        index=self.indices.get(result['tableKey'])
        result['index']=index
        if index is None:
            result['status']='not-in-table'
            return result
        # Only THX type=1 contains fixed 24-byte records. THN type=4 is name vectors.
        type_offset=self.field(self.root,0)
        if self.data[type_offset]!=1:raise ValueError('lookup digest needs THX type 1')
        off=self.record_vector+4+index*24
        result.update(field0=self.u32(off),field1=self.u32(off+4),
                      digest=self.data[off+8:off+24].hex(),status='native-path-key-match')
        return result

def main():
    import argparse,json
    p=argparse.ArgumentParser()
    p.add_argument('thx')
    p.add_argument('paths',nargs='+')
    args=p.parse_args()
    table=THFBPathLookup(args.thx)
    print(json.dumps([table.lookup(x) for x in args.paths],ensure_ascii=False,indent=2))

if __name__=='__main__':main()
