import { EventEmitter, Injectable, Provider } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { NgUploaderOptions } from '../classes/ng-uploader-options.class';
import { UploadedFile } from '../classes/uploaded-file.class';
import 'rxjs/add/observable/merge';

export enum UploadStatus {
  Queue,
  Uploading,
  Done
}

export interface UploadProgress {
  status: UploadStatus;
  data?: {
    percentage: number;
    speed: number;
    speedHuman: string;
  };
}

export interface UploadFile {
  id: string;
  fileIndex: number;
  lastModifiedDate: Date;
  name: string;
  size: number;
  type: string;
  progress: UploadProgress
}

export interface UploadOutput {
  type: 'addedToQueue' | 'allAddedToQueue' | 'uploading' | 'done' | 'removed' | 'start' | 'cancelled';
  file?: UploadFile;
}

export interface UploadInput {
  type: 'uploadAll' | 'uploadFile' | 'cancel' | 'cancelAll';
  id?: string;
  fileIndex?: number;
  file?: UploadFile;
  url?: string;
  method?: string;
}

export function humanizeBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 Byte';
  }

  const k = 1024;
  const sizes: string[] = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i: number = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

@Injectable()
export class NgUploaderService {
  fileList: FileList;
  files: UploadFile[];
  uploads: { file?: UploadFile, files?: UploadFile[], sub: Subscription }[];
  serviceEvents: EventEmitter<UploadOutput>;

  constructor() {
    this.files = [];
    this.serviceEvents = new EventEmitter<any>();
    this.uploads = [];
  }

  handleFiles = (files: FileList) => {
    this.fileList = files;
    this.files = [].map.call(files, (file: File, i: number) => {
      const uploadFile: UploadFile = {
        fileIndex: i,
        id: this.generateId(),
        name: file.name,
        size: file.size,
        type: file.type,
        progress: {
          status: UploadStatus.Queue,
          data: {
            percentage: 0,
            speed: null,
            speedHuman: null
          }
        },
        lastModifiedDate: file.lastModifiedDate
      };

      this.serviceEvents.emit({ type: 'addedToQueue', file: uploadFile });
      return uploadFile;
    });

    this.serviceEvents.emit({ type: 'allAddedToQueue' });
  };

  initInputEvents(input: EventEmitter<UploadInput>): void {
    input.subscribe((event: UploadInput) => {
      switch (event.type) {
        case 'uploadFile':
          this.serviceEvents.emit({ type: 'start', file: event.file });
          const sub = this.uploadFile(event.file, event.url, event.method).subscribe(data => {
            this.serviceEvents.emit(data);
          });

          this.uploads.push({ file: event.file, sub: sub });
        break;
        case 'uploadAll':
          this.files.forEach(file => {
            this.serviceEvents.emit({ type: 'start', file: file });
            const subscription = this.uploadFile(file, event.url, event.method).subscribe(data => {
              this.serviceEvents.emit(data);
            });

            this.uploads.push({ file: file, sub: subscription });
          });
        break;
        case 'cancel':
          const id = event.id || null;
          if (!id) {
            return;
          }

          const index = this.uploads.findIndex(upload => upload.file.id === id);
          if (index !== -1) {
            this.uploads[index].sub.unsubscribe();
            this.serviceEvents.emit({ type: 'cancelled', file: this.uploads[index].file });
            this.uploads.splice(index, 1);
            this.fileList = [].filter.call(this.fileList, (file: File, i: number) => i !== index);
            this.files.splice(index, 1);
          }
        break;
        case 'cancelAll':
          this.uploads.forEach(upload => {
            upload.sub.unsubscribe();
            this.serviceEvents.emit({ type: 'cancelled', file: upload.file });
          });
          this.uploads = [];
          this.fileList = null;
          this.files = [];
        break;
      }
    });
  }

  uploadFile(file: UploadFile, url: string, method = 'POST'): Observable<UploadOutput> {
    return new Observable(observer => {
      const reader = new FileReader();
      const xhr = new XMLHttpRequest();
      let time: number = new Date().getTime();
      let load = 0;

      xhr.upload.addEventListener('progress', (e: ProgressEvent) => {
        if (e.lengthComputable) {
          const percentage = Math.round((e.loaded * 100) / e.total);
          const diff = new Date().getTime() - time;
          time += diff;
          load = e.loaded - load;
          const speed = parseInt((load / diff * 1000) as any, 10);

          file.progress = {
            status: UploadStatus.Uploading,
            data: {
              percentage: percentage,
              speed: speed,
              speedHuman: `${humanizeBytes(speed)}/s`
            }
          };

          observer.next({ type: 'uploading', file: file });
        }
      }, false);

      xhr.upload.addEventListener('load', (e: Event) => {
        file.progress = {
          status: UploadStatus.Done,
          data: {
            percentage: 100,
            speed: null,
            speedHuman: null
          }
        };

        observer.next({ type: 'done', file: file });
        observer.complete();
      }, false);

      xhr.open(method, url);
      xhr.setRequestHeader('Content-Type', file.type);

      try {
        xhr.send(this.fileList.item(file.fileIndex));
      } catch (e) {
        observer.complete();
      }

      return () => {
        xhr.abort();
        reader.abort();
      };
    });
  }

  generateId(): string {
    return Math.random().toString(36).substring(7);
  }
}

export const NgUploaderServiceProvider: Provider = {
  provide: NgUploaderService, useClass: NgUploaderService
};
